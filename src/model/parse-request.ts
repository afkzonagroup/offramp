// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

import { isIsoInstant, isLocalDate } from '../time/zone.ts';
import { invalid } from '../util/errors.ts';
import { parseJson } from '../util/json.ts';
import { id, int, list, obj, oneOf, optBool, optEmail, optInt, optText, text, unique, ID_RE } from '../util/validate.ts';
import { CHARGE_KINDS, type ProviderProfile } from './profile.ts';
import {
  EVENT_TYPES,
  REQUEST_FORMAT,
  TARGET_KINDS,
  type AppliedCharge,
  type RequestEvent,
  type SwitchingRequest,
  type SwitchingTarget,
} from './request.ts';
import { PROFILE_LIMITS } from './parse-profile.ts';

export const REQUEST_LIMITS = { events: 100, charges: 200, ids: 1000, notes: 4000, reasons: 4000 } as const;

const NAME = { max: PROFILE_LIMITS.name } as const;
const LONG = { max: REQUEST_LIMITS.notes, multiline: true } as const;

function put<T extends object, K extends keyof T>(out: Partial<T>, key: K, value: T[K] | undefined): void {
  if (value !== undefined) out[key] = value;
}

/**
 * Request dates are limited to years before 3000, so that adding months and days in the timeline can never
 * leave the four-digit date format.
 */
export const MAX_REQUEST_YEAR = 2999;

function instant(v: unknown, path: string): string {
  const s = text(v, path, { max: 24 });
  if (!isIsoInstant(s)) invalid('must be a UTC timestamp such as 2026-03-01T09:00:00.000Z.', path);
  if (Number(s.slice(0, 4)) > MAX_REQUEST_YEAR) invalid(`must be before the year ${MAX_REQUEST_YEAR + 1}.`, path);
  return s;
}

function date(v: unknown, path: string): string {
  const s = text(v, path, { max: 10 });
  if (!isLocalDate(s)) invalid('must be a calendar date YYYY-MM-DD.', path);
  if (Number(s.slice(0, 4)) > MAX_REQUEST_YEAR) invalid(`must be before the year ${MAX_REQUEST_YEAR + 1}.`, path);
  return s;
}

function target(v: unknown, path: string): SwitchingTarget {
  if (v === null || typeof v !== 'object') invalid('must be an object.', path);
  const kind = oneOf((v as Record<string, unknown>).kind, `${path}.kind`, TARGET_KINDS);
  if (kind === 'erase') {
    obj(v, path, ['kind']);
    return { kind };
  }
  if (kind === 'on-premises') {
    const o = obj(v, path, ['kind', 'details']);
    const details = optText(o.details, `${path}.details`, LONG);
    return details === undefined ? { kind } : { kind, details };
  }
  const o = obj(v, path, ['kind', 'providerName', 'details']);
  const details = optText(o.details, `${path}.details`, LONG);
  // Art. 25(3)(a): the customer provides the necessary details of the destination provider.
  const providerName = text(o.providerName, `${path}.providerName`, NAME);
  return details === undefined ? { kind, providerName } : { kind, providerName, details };
}

/** Validates one event. Chronology and lifecycle rules are checked separately (see `checkEvents`). */
export function validateEvent(v: unknown, path: string): RequestEvent {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) invalid('must be an object.', path);
  const type = oneOf((v as Record<string, unknown>).type, `${path}.type`, EVENT_TYPES);
  const base = ['type', 'at', 'note'];
  const read = (extra: string[]): Record<string, unknown> => obj(v, path, [...base, ...extra]);
  const common = (o: Record<string, unknown>): { at: string; note?: string } => {
    const note = optText(o.note, `${path}.note`, LONG);
    return note === undefined ? { at: instant(o.at, `${path}.at`) } : { at: instant(o.at, `${path}.at`), note };
  };
  switch (type) {
    case 'unfeasibility-notified': {
      const o = read(['reasons', 'alternativeTransitionEnd']);
      return { type, ...common(o), reasons: text(o.reasons, `${path}.reasons`, { max: REQUEST_LIMITS.reasons, multiline: true }), alternativeTransitionEnd: date(o.alternativeTransitionEnd, `${path}.alternativeTransitionEnd`) };
    }
    case 'customer-extension': {
      const o = read(['newTransitionEnd']);
      return { type, ...common(o), newTransitionEnd: date(o.newTransitionEnd, `${path}.newTransitionEnd`) };
    }
    case 'erasure-confirmed': {
      const o = read(['scope']);
      const scope = optText(o.scope, `${path}.scope`, LONG);
      return scope === undefined ? { type, ...common(o) } : { type, ...common(o), scope };
    }
    case 'cancelled': {
      const o = read(['reason']);
      const reason = optText(o.reason, `${path}.reason`, LONG);
      return reason === undefined ? { type, ...common(o) } : { type, ...common(o), reason };
    }
    case 'transition-started':
    case 'switching-completed': {
      const o = read([]);
      return { type, ...common(o) };
    }
  }
}

function charge(v: unknown, path: string): AppliedCharge {
  const o = obj(v, path, ['id', 'chargeId', 'kind', 'description', 'amountMinor', 'directlyLinkedCostMinor', 'imposedOn', 'customerRequested', 'priceAgreedInAdvance']);
  const out: { -readonly [K in keyof AppliedCharge]?: AppliedCharge[K] } = {
    id: id(o.id, `${path}.id`),
    kind: oneOf(o.kind, `${path}.kind`, CHARGE_KINDS),
    amountMinor: int(o.amountMinor, `${path}.amountMinor`, 0, PROFILE_LIMITS.maxAmountMinor),
    imposedOn: date(o.imposedOn, `${path}.imposedOn`),
  };
  if (o.chargeId !== undefined) out.chargeId = id(o.chargeId, `${path}.chargeId`);
  put(out, 'description', optText(o.description, `${path}.description`, LONG));
  put(out, 'directlyLinkedCostMinor', optInt(o.directlyLinkedCostMinor, `${path}.directlyLinkedCostMinor`, 0, PROFILE_LIMITS.maxAmountMinor));
  put(out, 'customerRequested', optBool(o.customerRequested, `${path}.customerRequested`));
  put(out, 'priceAgreedInAdvance', optBool(o.priceAgreedInAdvance, `${path}.priceAgreedInAdvance`));
  return out as AppliedCharge;
}

const SWITCHING_EVENTS: ReadonlySet<string> = new Set(['unfeasibility-notified', 'customer-extension', 'transition-started', 'switching-completed']);

/**
 * The rules of the event log that do not depend on the profile or the clock, so that a hand-edited or imported
 * file cannot hold a sequence `addEvent` would refuse: every type at most once (Art. 25(5): one extension), in
 * time order, not before the request, nothing after erasure or cancellation, and no switching events on an
 * erase-only request. Deadlines are checked by the timeline, which reports them as findings.
 */
function checkEventSequence(events: readonly RequestEvent[], receivedAt: string, erase: boolean): void {
  const seen = new Set<string>();
  events.forEach((e, i) => {
    const path = `$.events[${i}]`;
    if (seen.has(e.type)) invalid(`"${e.type}" is recorded more than once; each event type can be recorded once.`, path);
    seen.add(e.type);
    if (e.at < receivedAt) invalid('is before the switching request was made.', `${path}.at`);
    const prev = events[i - 1];
    if (prev !== undefined) {
      if (e.at < prev.at) invalid('is before the previous event; events are kept in time order.', `${path}.at`);
      if (prev.type === 'erasure-confirmed' || prev.type === 'cancelled') invalid(`follows "${prev.type}", after which nothing can be recorded.`, path);
    }
    if (erase && SWITCHING_EVENTS.has(e.type)) invalid(`"${e.type}" does not apply to an erase-only request.`, path);
  });
}

/** Request identifiers double as file names in the local UI, so they are restricted further than other ids. */
export const REQUEST_ID_RE = ID_RE;

/**
 * Validates an untrusted value as a switching request (structure, types, limits). Throws OfframpError (INVALID).
 * Use {@link checkRequestAgainstProfile} to check its references against a provider profile.
 */
export function validateRequest(v: unknown): SwitchingRequest {
  const o = obj(v, '$', ['$schema', 'format', 'version', 'id', 'provider', 'profileDigest', 'customer', 'serviceIds', 'target', 'data', 'receivedAt', 'transitionStartDate', 'retrievalDays', 'erasureNotBefore', 'events', 'charges', 'notes']);
  if (o.format !== REQUEST_FORMAT) invalid(`must be "${REQUEST_FORMAT}".`, '$.format');
  if (o.version !== 1) invalid('must be 1.', '$.version');
  const c = obj(o.customer, '$.customer', ['name', 'reference', 'contactEmail']);
  const customer: Record<string, unknown> = { name: text(c.name, '$.customer.name', NAME) };
  put(customer, 'reference', optText(c.reference, '$.customer.reference', NAME));
  put(customer, 'contactEmail', optEmail(c.contactEmail, '$.customer.contactEmail'));
  const d = obj(o.data, '$.data', ['categoryIds', 'assetIds']);
  const data = { categoryIds: list(d.categoryIds ?? [], '$.data.categoryIds', REQUEST_LIMITS.ids, id), assetIds: list(d.assetIds ?? [], '$.data.assetIds', REQUEST_LIMITS.ids, id) };
  unique(data.categoryIds, '$.data.categoryIds');
  unique(data.assetIds, '$.data.assetIds');
  const serviceIds = list(o.serviceIds, '$.serviceIds', PROFILE_LIMITS.services, id);
  if (serviceIds.length === 0) invalid('must name at least one service.', '$.serviceIds');
  unique(serviceIds, '$.serviceIds');
  const events = list(o.events ?? [], '$.events', REQUEST_LIMITS.events, validateEvent);
  const tgt = target(o.target, '$.target');
  const receivedAt = instant(o.receivedAt, '$.receivedAt');
  checkEventSequence(events, receivedAt, tgt.kind === 'erase');
  const charges = list(o.charges ?? [], '$.charges', REQUEST_LIMITS.charges, charge);
  unique(charges.map((x) => x.id), '$.charges');
  const out: Record<string, unknown> = {
    format: REQUEST_FORMAT,
    version: 1,
    id: id(o.id, '$.id'),
    provider: text(o.provider, '$.provider', NAME),
    customer,
    serviceIds,
    target: tgt,
    data,
    receivedAt,
    events,
    charges,
  };
  if (o.profileDigest !== undefined) out.profileDigest = text(o.profileDigest, '$.profileDigest', { max: 64, pattern: /^[0-9a-f]{64}$/u, patternHint: 'a lower-case hex SHA-256 digest' });
  if (o.transitionStartDate !== undefined) out.transitionStartDate = date(o.transitionStartDate, '$.transitionStartDate');
  put(out, 'retrievalDays', optInt(o.retrievalDays, '$.retrievalDays', 1, PROFILE_LIMITS.maxDays));
  if (o.erasureNotBefore !== undefined) out.erasureNotBefore = date(o.erasureNotBefore, '$.erasureNotBefore');
  put(out, 'notes', optText(o.notes, '$.notes', LONG));
  return out as unknown as SwitchingRequest;
}

/** Parses and validates switching request JSON text. */
export function parseRequest(json: string): SwitchingRequest {
  return validateRequest(parseJson(json, 'Switching request'));
}

/**
 * Checks that a request refers to things that exist in the provider profile: services, data categories and
 * digital assets of those services, and charge items. Throws OfframpError (INVALID) on the first mismatch.
 */
export function checkRequestAgainstProfile(req: SwitchingRequest, profile: ProviderProfile): void {
  if (req.provider !== profile.provider.name) invalid(`names provider "${req.provider}" but the profile is for "${profile.provider.name}".`, '$.provider');
  const services = req.serviceIds.map((sid, i) => {
    const s = profile.services.find((x) => x.id === sid);
    if (s === undefined) invalid(`unknown service "${sid}".`, `$.serviceIds[${i}]`);
    return s;
  });
  const categories = new Set(services.flatMap((s) => (s.exportableData ?? []).map((c) => c.id)));
  const assets = new Set(services.flatMap((s) => (s.digitalAssets ?? []).map((a) => a.id)));
  const exempted = new Set(services.flatMap((s) => (s.exemptedData ?? []).map((e) => e.id)));
  req.data.categoryIds.forEach((cid, i) => {
    if (exempted.has(cid)) invalid(`"${cid}" is an exempted category (Art. 25(2)(f)) and cannot be chosen for porting.`, `$.data.categoryIds[${i}]`);
    if (!categories.has(cid)) invalid(`unknown data category "${cid}" for the chosen services.`, `$.data.categoryIds[${i}]`);
  });
  req.data.assetIds.forEach((aid, i) => {
    if (!assets.has(aid)) invalid(`unknown digital asset "${aid}" for the chosen services.`, `$.data.assetIds[${i}]`);
  });
  const items = profile.charges?.items ?? [];
  req.charges.forEach((c, i) => {
    if (c.chargeId === undefined) return;
    const item = items.find((x) => x.id === c.chargeId);
    if (item === undefined) invalid(`unknown charge item "${c.chargeId}".`, `$.charges[${i}].chargeId`);
    if (item.kind !== c.kind) invalid(`kind "${c.kind}" differs from the charge item's kind "${item.kind}".`, `$.charges[${i}].kind`);
  });
}
