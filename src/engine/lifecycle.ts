// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

import { LAW } from '../legal/refs.ts';
import type { ProviderProfile } from '../model/profile.ts';
import { checkRequestAgainstProfile, validateEvent, validateRequest } from '../model/parse-request.ts';
import { REQUEST_FORMAT, type ChosenData, type Customer, type SwitchingRequest, type SwitchingTarget } from '../model/request.ts';
import { endOfDay, toMs, type LocalDate } from '../time/zone.ts';
import { OfframpError } from '../util/errors.ts';
import { digest } from '../util/json.ts';
import { computeTimeline } from './timeline.ts';

function conflict(message: string): never {
  throw new OfframpError('CONFLICT', message);
}

export interface NewRequest {
  readonly id: string;
  readonly customer: Customer;
  readonly serviceIds: readonly string[];
  readonly target: SwitchingTarget;
  /** Chosen data; default: every exportable data category and digital asset of the chosen services. */
  readonly data?: ChosenData;
  /** When the request was made (UTC ISO). */
  readonly receivedAt: string;
  readonly transitionStartDate?: LocalDate;
  readonly retrievalDays?: number;
  readonly erasureNotBefore?: LocalDate;
  readonly notes?: string;
}

/**
 * Creates a validated switching request against a provider profile. When no data is chosen, every exportable
 * data category and digital asset of the chosen services is included (Art. 25(2)(e): at a minimum, all
 * exportable data).
 */
export function createRequest(profile: ProviderProfile, input: NewRequest): SwitchingRequest {
  const services = input.serviceIds.map((sid) => profile.services.find((s) => s.id === sid));
  const data: ChosenData =
    input.data ??
    (input.target.kind === 'erase'
      ? { categoryIds: [], assetIds: [] }
      : {
          categoryIds: services.flatMap((s) => (s?.exportableData ?? []).map((c) => c.id)),
          assetIds: services.flatMap((s) => (s?.digitalAssets ?? []).map((a) => a.id)),
        });
  const candidate = {
    format: REQUEST_FORMAT,
    version: 1,
    id: input.id,
    provider: profile.provider.name,
    profileDigest: digest(profile),
    customer: input.customer,
    serviceIds: input.serviceIds,
    target: input.target,
    data,
    receivedAt: input.receivedAt,
    ...(input.transitionStartDate === undefined ? {} : { transitionStartDate: input.transitionStartDate }),
    ...(input.retrievalDays === undefined ? {} : { retrievalDays: input.retrievalDays }),
    ...(input.erasureNotBefore === undefined ? {} : { erasureNotBefore: input.erasureNotBefore }),
    events: [],
    charges: [],
    ...(input.notes === undefined ? {} : { notes: input.notes }),
  };
  const req = validateRequest(candidate);
  checkRequestAgainstProfile(req, profile);
  return req;
}

/**
 * Appends an event after checking it against the lifecycle rules and the statutory periods. Returns a new
 * request; the input is not changed. Throws OfframpError (INVALID for malformed events, CONFLICT for events
 * that the rules do not allow at this point).
 *
 * Rules: every event type at most once; events in time order, not before the request and not in the future;
 * nothing after erasure or cancellation; erase-only requests have no transitional period events; Art. 25(4)
 * alternative period longer than the standard one and at most seven months; Art. 25(5) customer extension
 * once, before the transitional period ends, to a later day; erasure after a completed switch (Art. 25(2)(h))
 * or, for erase-only requests, after the contract ends; no cancellation after completion.
 */
export function addEvent(profile: ProviderProfile, req: SwitchingRequest, input: unknown, now: number = Date.now()): SwitchingRequest {
  const event = validateEvent(input, '$.event');
  const at = toMs(event.at);
  const zone = profile.timeZone;
  if (at > now) conflict('The event time is in the future.');
  if (at < toMs(req.receivedAt)) conflict('The event is before the switching request was made.');
  const last = req.events.at(-1);
  if (last !== undefined && at < toMs(last.at)) conflict(`The event is before the last recorded event (${last.type} at ${last.at}). Record events in order.`);
  if (req.events.some((e) => e.type === event.type)) conflict(`"${event.type}" is already recorded; it can be recorded once.`);
  if (req.events.some((e) => e.type === 'erasure-confirmed')) conflict('Erasure is confirmed; the request is closed.');
  if (req.events.some((e) => e.type === 'cancelled')) conflict('The request is cancelled; nothing more can be recorded.');
  const erase = req.target.kind === 'erase';
  const completed = req.events.some((e) => e.type === 'switching-completed');
  const t = computeTimeline(profile, req, { now: at });

  switch (event.type) {
    case 'unfeasibility-notified': {
      if (erase || t.transition === undefined) return conflict('An erase-only request has no transitional period to extend.');
      if (completed) conflict('Switching is already completed.');
      if (event.alternativeTransitionEnd <= t.transition.standardLastDay) conflict(`The alternative transitional period must end after the standard one (${t.transition.standardLastDay}).`);
      if (event.alternativeTransitionEnd > t.transition.alternativeCapLastDay) {
        conflict(`Art. 25(4): the alternative transitional period must not exceed ${LAW.maxAlternativeTransitionMonths} months; its last day can be ${t.transition.alternativeCapLastDay} at the latest.`);
      }
      if (at >= endOfDay(t.transition.lastDay, zone)) conflict('The transitional period has already ended.');
      break;
    }
    case 'customer-extension': {
      if (erase || t.transition === undefined) return conflict('An erase-only request has no transitional period to extend.');
      if (completed) conflict('Switching is already completed.');
      if (at >= endOfDay(t.transition.lastDay, zone)) conflict(`The transitional period ended on ${t.transition.lastDay}; recital 87: the extension is made before or during it.`);
      if (event.newTransitionEnd <= t.transition.lastDay) conflict(`The new end must be after the current end of the transitional period (${t.transition.lastDay}).`);
      break;
    }
    case 'transition-started':
    case 'switching-completed': {
      if (erase) conflict('An erase-only request has no switching to record.');
      break;
    }
    case 'erasure-confirmed': {
      if (!erase && !completed) conflict('Record the successful completion of switching first (Art. 25(2)(h)).');
      if (erase && at < endOfDay(t.notice.lastDay, zone)) conflict(`The contract ends with the notice period on ${t.notice.lastDay} (Art. 25(2)(c)(ii)); record erasure after that.`);
      break;
    }
    case 'cancelled': {
      if (completed) conflict('Switching is completed; the request can no longer be cancelled.');
      if (erase && at >= endOfDay(t.notice.lastDay, zone)) conflict(`The contract ended with the notice period on ${t.notice.lastDay} (Art. 25(2)(c)(ii)); the request can no longer be withdrawn.`);
      break;
    }
  }
  const next = { ...req, events: [...req.events, event] };
  return validateRequest(next);
}
