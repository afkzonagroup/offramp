// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

import { isValidTimeZone, isLocalDate } from '../time/zone.ts';
import { invalid } from '../util/errors.ts';
import { parseJson } from '../util/json.ts';
import { bool, id, int, list, obj, oneOf, optBool, optEmail, optInt, optList, optText, optUrl, text, unique } from '../util/validate.ts';
import {
  ASSET_KINDS,
  CHARGE_KINDS,
  DATA_ORIGINS,
  DELIVERY_MODELS,
  INTERFACE_KINDS,
  PROFILE_FORMAT,
  REGIMES,
  UNBUNDLING,
  type ChargeItem,
  type ChargeSchedule,
  type ContractTerms,
  type DataCategory,
  type DataFormat,
  type DigitalAsset,
  type Duration,
  type ExemptedCategory,
  type FunctionalEquivalenceSupport,
  type InformationDuties,
  type InternationalAccess,
  type ProviderProfile,
  type ServiceProfile,
  type SwitchingInterface,
  type WorkingDays,
} from './profile.ts';

/** Limits on sizes, shared with the JSON schema. */
export const PROFILE_LIMITS = {
  name: 200,
  shortText: 500,
  longText: 4000,
  services: 100,
  categories: 500,
  assets: 500,
  exempted: 200,
  interfaces: 50,
  formats: 20,
  textItems: 100,
  holidays: 1000,
  charges: 500,
  clauseRef: 40,
  maxAmountMinor: 1_000_000_000_000,
  maxDays: 3650,
} as const;

const L = PROFILE_LIMITS;
const NAME = { max: L.name } as const;
const SHORT = { max: L.shortText } as const;
const LONG = { max: L.longText, multiline: true } as const;

/** Keys of ContractTerms whose value is a boolean flag. */
export const CONTRACT_FLAGS = [
  'writtenContract',
  'availableBeforeSigning',
  'storableAndReproducible',
  'switchingClause',
  'reasonableAssistance',
  'businessContinuity',
  'knownRisksInformation',
  'highLevelOfSecurity',
  'exitStrategySupport',
  'terminationOnSuccessfulSwitch',
  'terminationOnEraseAtNoticeEnd',
  'terminationNotified',
  'erasureGuaranteed',
  'chargesClause',
  'optionSwitchToProvider',
  'optionSwitchToOnPremises',
  'optionErase',
  'unfeasibilityClause',
  'customerExtensionRight',
  'internationalAccessWebsitesListed',
] as const satisfies readonly (keyof ContractTerms)[];

const CONTRACT_NUMBERS = ['transitionDays', 'retrievalDays', 'unfeasibilityNoticeWorkingDays', 'maxAlternativeTransitionMonths'] as const satisfies readonly (keyof ContractTerms)[];
const CONTRACT_KEYS: readonly string[] = [...CONTRACT_FLAGS, ...CONTRACT_NUMBERS, 'noticePeriod', 'clauseRefs'];

const INFO_FLAGS = [
  'registerCoversDataStructures',
  'registerCoversDataFormats',
  'registerCoversStandards',
  'registerCoversOpenInteroperabilitySpecifications',
  'preContractStandardServiceFees',
  'preContractEarlyTerminationPenalties',
  'preContractReducedSwitchingCharges',
  'exemptionsInformedBeforeContract',
] as const satisfies readonly (keyof InformationDuties)[];

/** Copies `key` into `out` when the source has it. Keeps optional properties absent instead of undefined. */
function put<T extends object, K extends keyof T>(out: Partial<T>, key: K, value: T[K] | undefined): void {
  if (value !== undefined) out[key] = value;
}

function textList(v: unknown, path: string): string[] | undefined {
  return optList(v, path, L.textItems, (x, p) => text(x, p, SHORT));
}

function format(v: unknown, path: string): DataFormat {
  const o = obj(v, path, ['name', 'mediaType', 'specificationUrl', 'structured', 'commonlyUsed', 'machineReadable', 'openSpecification']);
  const out: { -readonly [K in keyof DataFormat]?: DataFormat[K] } = { name: text(o.name, `${path}.name`, NAME) };
  put(out, 'mediaType', optText(o.mediaType, `${path}.mediaType`, { max: 127, pattern: /^[a-z0-9][a-z0-9!#$&^_.+-]{0,62}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,62}$/u, patternHint: 'a media type such as text/csv' }));
  put(out, 'specificationUrl', optUrl(o.specificationUrl, `${path}.specificationUrl`));
  for (const k of ['structured', 'commonlyUsed', 'machineReadable', 'openSpecification'] as const) put(out, k, optBool(o[k], `${path}.${k}`));
  return out as DataFormat;
}

function formats(v: unknown, path: string): DataFormat[] {
  return list(v ?? [], path, L.formats, format);
}

function category(v: unknown, path: string): DataCategory {
  const o = obj(v, path, ['id', 'name', 'description', 'origin', 'formats']);
  const out: { -readonly [K in keyof DataCategory]?: DataCategory[K] } = { id: id(o.id, `${path}.id`), name: text(o.name, `${path}.name`, NAME), formats: formats(o.formats, `${path}.formats`) };
  put(out, 'description', optText(o.description, `${path}.description`, LONG));
  if (o.origin !== undefined) out.origin = oneOf(o.origin, `${path}.origin`, DATA_ORIGINS);
  return out as DataCategory;
}

function asset(v: unknown, path: string): DigitalAsset {
  const o = obj(v, path, ['id', 'name', 'kind', 'description', 'formats']);
  const out: { -readonly [K in keyof DigitalAsset]?: DigitalAsset[K] } = {
    id: id(o.id, `${path}.id`),
    name: text(o.name, `${path}.name`, NAME),
    kind: oneOf(o.kind, `${path}.kind`, ASSET_KINDS),
    formats: formats(o.formats, `${path}.formats`),
  };
  put(out, 'description', optText(o.description, `${path}.description`, LONG));
  return out as DigitalAsset;
}

function exempted(v: unknown, path: string): ExemptedCategory {
  const o = obj(v, path, ['id', 'name', 'reason', 'tradeSecretRisk']);
  return { id: id(o.id, `${path}.id`), name: text(o.name, `${path}.name`, NAME), reason: text(o.reason, `${path}.reason`, LONG), tradeSecretRisk: bool(o.tradeSecretRisk, `${path}.tradeSecretRisk`) };
}

function iface(v: unknown, path: string): SwitchingInterface {
  const o = obj(v, path, ['name', 'kind', 'documentationUrl', 'freeOfCharge', 'availableToAllCustomers', 'availableToDestinationProviders']);
  const out: { -readonly [K in keyof SwitchingInterface]?: SwitchingInterface[K] } = { name: text(o.name, `${path}.name`, NAME), kind: oneOf(o.kind, `${path}.kind`, INTERFACE_KINDS) };
  put(out, 'documentationUrl', optUrl(o.documentationUrl, `${path}.documentationUrl`));
  for (const k of ['freeOfCharge', 'availableToAllCustomers', 'availableToDestinationProviders'] as const) put(out, k, optBool(o[k], `${path}.${k}`));
  return out as SwitchingInterface;
}

function functionalEquivalence(v: unknown, path: string): FunctionalEquivalenceSupport {
  const o = obj(v, path, ['capabilities', 'information', 'documentation', 'technicalSupport', 'tools']);
  const out: { -readonly [K in keyof FunctionalEquivalenceSupport]?: FunctionalEquivalenceSupport[K] } = {};
  for (const k of ['capabilities', 'information', 'documentation', 'technicalSupport'] as const) put(out, k, optBool(o[k], `${path}.${k}`));
  put(out, 'tools', textList(o.tools, `${path}.tools`));
  return out;
}

function service(v: unknown, path: string): ServiceProfile {
  const o = obj(v, path, [
    'id', 'name', 'description', 'deliveryModel', 'serviceType', 'regime', 'offeredAtBroadCommercialScale', 'limitedPeriodDays',
    'exportableData', 'digitalAssets', 'exemptedData', 'interfaces', 'switchingMethods', 'knownRestrictions', 'standards',
    'functionalEquivalence', 'unbundling', 'unbundlingNote', 'freeTier', 'estimatedSwitchingTime', 'complexSwitchingInfo',
  ]);
  const out: { -readonly [K in keyof ServiceProfile]?: ServiceProfile[K] } = {
    id: id(o.id, `${path}.id`),
    name: text(o.name, `${path}.name`, NAME),
    deliveryModel: oneOf(o.deliveryModel, `${path}.deliveryModel`, DELIVERY_MODELS),
    regime: oneOf(o.regime ?? 'standard', `${path}.regime`, REGIMES),
  };
  put(out, 'description', optText(o.description, `${path}.description`, LONG));
  put(out, 'serviceType', optText(o.serviceType, `${path}.serviceType`, LONG));
  put(out, 'offeredAtBroadCommercialScale', optBool(o.offeredAtBroadCommercialScale, `${path}.offeredAtBroadCommercialScale`));
  put(out, 'limitedPeriodDays', optInt(o.limitedPeriodDays, `${path}.limitedPeriodDays`, 1, L.maxDays));
  const cats = optList(o.exportableData, `${path}.exportableData`, L.categories, category);
  const assets = optList(o.digitalAssets, `${path}.digitalAssets`, L.assets, asset);
  const ex = optList(o.exemptedData, `${path}.exemptedData`, L.exempted, exempted);
  // Categories, assets and exempted categories share one namespace, so a request can name any of them unambiguously.
  unique([...(cats ?? []), ...(assets ?? []), ...(ex ?? [])].map((x) => x.id), `${path}.exportableData|digitalAssets|exemptedData`);
  put(out, 'exportableData', cats);
  put(out, 'digitalAssets', assets);
  put(out, 'exemptedData', ex);
  put(out, 'interfaces', optList(o.interfaces, `${path}.interfaces`, L.interfaces, iface));
  put(out, 'switchingMethods', textList(o.switchingMethods, `${path}.switchingMethods`));
  put(out, 'knownRestrictions', textList(o.knownRestrictions, `${path}.knownRestrictions`));
  put(out, 'standards', textList(o.standards, `${path}.standards`));
  if (o.functionalEquivalence !== undefined) out.functionalEquivalence = functionalEquivalence(o.functionalEquivalence, `${path}.functionalEquivalence`);
  if (o.unbundling !== undefined) out.unbundling = oneOf(o.unbundling, `${path}.unbundling`, UNBUNDLING);
  put(out, 'unbundlingNote', optText(o.unbundlingNote, `${path}.unbundlingNote`, LONG));
  put(out, 'freeTier', optBool(o.freeTier, `${path}.freeTier`));
  put(out, 'estimatedSwitchingTime', optText(o.estimatedSwitchingTime, `${path}.estimatedSwitchingTime`, SHORT));
  put(out, 'complexSwitchingInfo', optText(o.complexSwitchingInfo, `${path}.complexSwitchingInfo`, LONG));
  return out as ServiceProfile;
}

function duration(v: unknown, path: string): Duration {
  const o = obj(v, path, ['unit', 'value']);
  const unit = oneOf(o.unit, `${path}.unit`, ['days', 'months'] as const);
  return { unit, value: int(o.value, `${path}.value`, 0, unit === 'days' ? L.maxDays : 120) };
}

function contract(v: unknown, path: string): ContractTerms {
  const o = obj(v, path, CONTRACT_KEYS);
  const out: Record<string, unknown> = {};
  for (const k of CONTRACT_FLAGS) put(out, k, optBool(o[k], `${path}.${k}`));
  put(out, 'transitionDays', optInt(o.transitionDays, `${path}.transitionDays`, 1, L.maxDays));
  put(out, 'retrievalDays', optInt(o.retrievalDays, `${path}.retrievalDays`, 0, L.maxDays));
  put(out, 'unfeasibilityNoticeWorkingDays', optInt(o.unfeasibilityNoticeWorkingDays, `${path}.unfeasibilityNoticeWorkingDays`, 0, 365));
  put(out, 'maxAlternativeTransitionMonths', optInt(o.maxAlternativeTransitionMonths, `${path}.maxAlternativeTransitionMonths`, 0, 120));
  if (o.noticePeriod !== undefined) out.noticePeriod = duration(o.noticePeriod, `${path}.noticePeriod`);
  if (o.clauseRefs !== undefined) {
    const refs = obj(o.clauseRefs, `${path}.clauseRefs`, CONTRACT_KEYS.filter((k) => k !== 'clauseRefs'));
    const clean: Record<string, string> = {};
    for (const [k, x] of Object.entries(refs)) clean[k] = text(x, `${path}.clauseRefs.${k}`, { max: L.clauseRef });
    out.clauseRefs = clean;
  }
  return out;
}

function information(v: unknown, path: string): InformationDuties {
  const o = obj(v, path, ['switchingProcedures', 'onlineRegisterUrl', 'chargesInformationUrl', ...INFO_FLAGS]);
  const out: Record<string, unknown> = {};
  put(out, 'switchingProcedures', optText(o.switchingProcedures, `${path}.switchingProcedures`, LONG));
  put(out, 'onlineRegisterUrl', optUrl(o.onlineRegisterUrl, `${path}.onlineRegisterUrl`));
  put(out, 'chargesInformationUrl', optUrl(o.chargesInformationUrl, `${path}.chargesInformationUrl`));
  for (const k of INFO_FLAGS) put(out, k, optBool(o[k], `${path}.${k}`));
  return out;
}

function international(v: unknown, path: string): InternationalAccess {
  const o = obj(v, path, ['jurisdictions', 'jurisdictionInformationUrl', 'measuresInformationUrl']);
  const out: { -readonly [K in keyof InternationalAccess]?: InternationalAccess[K] } = {};
  put(out, 'jurisdictions', optList(o.jurisdictions, `${path}.jurisdictions`, L.textItems, (x, p) => text(x, p, NAME)));
  put(out, 'jurisdictionInformationUrl', optUrl(o.jurisdictionInformationUrl, `${path}.jurisdictionInformationUrl`));
  put(out, 'measuresInformationUrl', optUrl(o.measuresInformationUrl, `${path}.measuresInformationUrl`));
  return out;
}

function date(v: unknown, path: string): string {
  const s = text(v, path, { max: 10 });
  if (!isLocalDate(s)) invalid('must be a calendar date YYYY-MM-DD.', path);
  return s;
}

function charge(v: unknown, path: string): ChargeItem {
  const o = obj(v, path, ['id', 'name', 'kind', 'amountMinor', 'unit', 'directlyLinkedCostMinor', 'costBasis', 'appliesFrom', 'appliesUntil', 'serviceIds', 'onlyOnCustomerRequest', 'priceAgreedInAdvance']);
  const out: { -readonly [K in keyof ChargeItem]?: ChargeItem[K] } = {
    id: id(o.id, `${path}.id`),
    name: text(o.name, `${path}.name`, NAME),
    kind: oneOf(o.kind, `${path}.kind`, CHARGE_KINDS),
    amountMinor: int(o.amountMinor, `${path}.amountMinor`, 0, L.maxAmountMinor),
  };
  put(out, 'unit', optText(o.unit, `${path}.unit`, NAME));
  put(out, 'directlyLinkedCostMinor', optInt(o.directlyLinkedCostMinor, `${path}.directlyLinkedCostMinor`, 0, L.maxAmountMinor));
  put(out, 'costBasis', optText(o.costBasis, `${path}.costBasis`, LONG));
  if (o.appliesFrom !== undefined) out.appliesFrom = date(o.appliesFrom, `${path}.appliesFrom`);
  if (o.appliesUntil !== undefined) out.appliesUntil = date(o.appliesUntil, `${path}.appliesUntil`);
  if (out.appliesFrom !== undefined && out.appliesUntil !== undefined && out.appliesUntil < out.appliesFrom) invalid('must not be before appliesFrom.', `${path}.appliesUntil`);
  put(out, 'serviceIds', optList(o.serviceIds, `${path}.serviceIds`, L.services, id));
  put(out, 'onlyOnCustomerRequest', optBool(o.onlyOnCustomerRequest, `${path}.onlyOnCustomerRequest`));
  put(out, 'priceAgreedInAdvance', optBool(o.priceAgreedInAdvance, `${path}.priceAgreedInAdvance`));
  return out as ChargeItem;
}

function charges(v: unknown, path: string): ChargeSchedule {
  const o = obj(v, path, ['currency', 'items']);
  const items = list(o.items ?? [], `${path}.items`, L.charges, charge);
  unique(items.map((c) => c.id), `${path}.items`);
  return { currency: text(o.currency, `${path}.currency`, { max: 3, pattern: /^[A-Z]{3}$/u, patternHint: 'an ISO 4217 currency code such as EUR' }), items };
}

function workingDays(v: unknown, path: string): WorkingDays {
  const o = obj(v, path, ['publicHolidays', 'calendarName']);
  const out: { -readonly [K in keyof WorkingDays]?: WorkingDays[K] } = { publicHolidays: list(o.publicHolidays ?? [], `${path}.publicHolidays`, L.holidays, date) };
  put(out, 'calendarName', optText(o.calendarName, `${path}.calendarName`, NAME));
  return out as WorkingDays;
}

/**
 * Validates an untrusted value as a provider profile. Throws OfframpError (code INVALID) with the JSON path
 * of the first problem. Unknown properties are rejected.
 */
export function validateProfile(v: unknown): ProviderProfile {
  const o = obj(v, '$', ['$schema', 'format', 'version', 'provider', 'timeZone', 'workingDays', 'services', 'contract', 'information', 'internationalAccess', 'charges']);
  if (o.format !== PROFILE_FORMAT) invalid(`must be "${PROFILE_FORMAT}".`, '$.format');
  if (o.version !== 1) invalid('must be 1.', '$.version');
  const p = obj(o.provider, '$.provider', ['name', 'legalName', 'website', 'contactEmail', 'switchingContact']);
  const provider: Record<string, unknown> = { name: text(p.name, '$.provider.name', NAME) };
  put(provider, 'legalName', optText(p.legalName, '$.provider.legalName', NAME));
  put(provider, 'website', optUrl(p.website, '$.provider.website'));
  put(provider, 'contactEmail', optEmail(p.contactEmail, '$.provider.contactEmail'));
  put(provider, 'switchingContact', optText(p.switchingContact, '$.provider.switchingContact', SHORT));
  const timeZone = text(o.timeZone, '$.timeZone', { max: 64 });
  if (!isValidTimeZone(timeZone)) invalid('must be an IANA time zone such as Europe/Vilnius.', '$.timeZone');
  const services = list(o.services, '$.services', L.services, service);
  if (services.length === 0) invalid('must list at least one service.', '$.services');
  unique(services.map((s) => s.id), '$.services');
  const out: Record<string, unknown> = { format: PROFILE_FORMAT, version: 1, provider, timeZone, services };
  put(out, '$schema', optText(o.$schema, '$.$schema', { max: 2048 }));
  if (o.workingDays !== undefined) out.workingDays = workingDays(o.workingDays, '$.workingDays');
  if (o.contract !== undefined) out.contract = contract(o.contract, '$.contract');
  if (o.information !== undefined) out.information = information(o.information, '$.information');
  if (o.internationalAccess !== undefined) out.internationalAccess = international(o.internationalAccess, '$.internationalAccess');
  if (o.charges !== undefined) {
    const c = charges(o.charges, '$.charges');
    const known = new Set(services.map((s) => s.id));
    c.items.forEach((item, i) => {
      item.serviceIds?.forEach((sid, j) => {
        if (!known.has(sid)) invalid(`unknown service "${sid}".`, `$.charges.items[${i}].serviceIds[${j}]`);
      });
    });
    out.charges = c;
  }
  return out as unknown as ProviderProfile;
}

/** Parses and validates provider profile JSON text. */
export function parseProfile(json: string): ProviderProfile {
  return validateProfile(parseJson(json, 'Provider profile'));
}
