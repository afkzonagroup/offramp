// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

import { PROFILE_LIMITS, CONTRACT_FLAGS } from '../model/parse-profile.ts';
import { REQUEST_LIMITS } from '../model/parse-request.ts';
import { ASSET_KINDS, CHARGE_KINDS, DATA_ORIGINS, DELIVERY_MODELS, INTERFACE_KINDS, PROFILE_FORMAT, REGIMES, UNBUNDLING } from '../model/profile.ts';
import { EVENT_TYPES, REQUEST_FORMAT } from '../model/request.ts';

/**
 * JSON Schemas (draft 2020-12) of the provider profile and the switching request, so other tools can produce
 * and check Offramp files. They describe the structure and limits; the TypeScript validators are the reference
 * and are a little stricter (calendar dates must exist, time zones must be known to the runtime, identifiers
 * must be unique, references must resolve). Tests run both against the same examples.
 */

export const SCHEMA_BASE = 'https://github.com/afkzonagroup/offramp/raw/main/schema';
export const PROFILE_SCHEMA_ID = `${SCHEMA_BASE}/provider-profile.schema.json`;
export const REQUEST_SCHEMA_ID = `${SCHEMA_BASE}/switching-request.schema.json`;

type Json = null | boolean | number | string | readonly Json[] | { readonly [k: string]: Json };

/** Characters the validators refuse in text: C0/C1 controls, bidirectional, zero-width, separators, BOM. */
const UNSAFE = '\\u0000-\\u0008\\u000b-\\u001f\\u007f-\\u009f\\u061c\\u200b-\\u200f\\u2028-\\u202e\\u2060-\\u2069\\ufeff';

function textDef(max: number, multiline: boolean): Json {
  return {
    type: 'string',
    maxLength: max,
    allOf: [{ pattern: '\\S' }, { pattern: multiline ? `^[^${UNSAFE}]*$` : `^[^${UNSAFE}\\n\\t]*$` }],
  };
}

const L = PROFILE_LIMITS;
const ref = (name: string): Json => ({ $ref: `#/$defs/${name}` });
const arr = (items: Json, max: number, extra: Record<string, Json> = {}): Json => ({ type: 'array', items, maxItems: max, ...extra });
const bool: Json = { type: 'boolean' };
const enumOf = (values: readonly string[]): Json => ({ type: 'string', enum: [...values] });
const strict = (properties: Record<string, Json>, required: readonly string[] = []): Json => ({ type: 'object', additionalProperties: false, required: [...required], properties });

const commonDefs: Record<string, Json> = {
  id: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$' },
  name: textDef(L.name, false),
  shortText: textDef(L.shortText, false),
  longText: textDef(L.longText, true),
  url: { type: 'string', maxLength: 2048, pattern: '^https?://[^\\s/?#@]+(?:[/?#]\\S*)?$' },
  email: { type: 'string', maxLength: 254, pattern: '^[^\\s@<>()[\\]\\\\,;:"]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,62}[A-Za-z0-9])?(?:\\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,62}[A-Za-z0-9])?)+$' },
  date: { type: 'string', pattern: '^\\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01])$', description: 'Calendar date YYYY-MM-DD (the date must exist).' },
  amountMinor: { type: 'integer', minimum: 0, maximum: L.maxAmountMinor, description: 'Amount in minor units of the currency (e.g. cents).' },
};

/** JSON Schema of the provider profile. */
export const PROVIDER_PROFILE_SCHEMA: Json = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: PROFILE_SCHEMA_ID,
  title: 'Offramp provider profile',
  description: 'What a provider of data processing services states about switching under Chapter VI of Regulation (EU) 2023/2854.',
  ...(strict(
    {
      $schema: { type: 'string', maxLength: 2048 },
      format: { const: PROFILE_FORMAT },
      version: { const: 1 },
      provider: strict({ name: ref('name'), legalName: ref('name'), website: ref('url'), contactEmail: ref('email'), switchingContact: ref('shortText') }, ['name']),
      timeZone: { type: 'string', maxLength: 64, pattern: '^[A-Za-z][A-Za-z0-9_+\\-/]*$', description: 'IANA time zone, e.g. Europe/Vilnius.' },
      workingDays: strict({ publicHolidays: arr(ref('date'), L.holidays), calendarName: ref('name') }),
      services: arr(ref('service'), L.services, { minItems: 1 }),
      contract: ref('contract'),
      information: ref('information'),
      internationalAccess: strict({ jurisdictions: arr(ref('name'), L.textItems), jurisdictionInformationUrl: ref('url'), measuresInformationUrl: ref('url') }),
      charges: strict({ currency: { type: 'string', pattern: '^[A-Z]{3}$' }, items: arr(ref('charge'), L.charges) }, ['currency']),
    },
    ['format', 'version', 'provider', 'timeZone', 'services'],
  ) as Record<string, Json>),
  $defs: {
    ...commonDefs,
    format: strict({ name: ref('name'), mediaType: { type: 'string', maxLength: 127, pattern: '^[a-z0-9][a-z0-9!#$&^_.+-]{0,62}/[a-z0-9][a-z0-9!#$&^_.+-]{0,62}$' }, specificationUrl: ref('url'), structured: bool, commonlyUsed: bool, machineReadable: bool, openSpecification: bool }, ['name']),
    category: strict({ id: ref('id'), name: ref('name'), description: ref('longText'), origin: enumOf(DATA_ORIGINS), formats: arr(ref('format'), L.formats) }, ['id', 'name']),
    asset: strict({ id: ref('id'), name: ref('name'), kind: enumOf(ASSET_KINDS), description: ref('longText'), formats: arr(ref('format'), L.formats) }, ['id', 'name', 'kind']),
    exempted: strict({ id: ref('id'), name: ref('name'), reason: ref('longText'), tradeSecretRisk: bool }, ['id', 'name', 'reason', 'tradeSecretRisk']),
    interface: strict({ name: ref('name'), kind: enumOf(INTERFACE_KINDS), documentationUrl: ref('url'), freeOfCharge: bool, availableToAllCustomers: bool, availableToDestinationProviders: bool }, ['name', 'kind']),
    service: strict(
      {
        id: ref('id'),
        name: ref('name'),
        description: ref('longText'),
        deliveryModel: enumOf(DELIVERY_MODELS),
        serviceType: ref('longText'),
        regime: { ...(enumOf(REGIMES) as Record<string, Json>), default: 'standard' },
        offeredAtBroadCommercialScale: bool,
        limitedPeriodDays: { type: 'integer', minimum: 1, maximum: L.maxDays },
        exportableData: arr(ref('category'), L.categories),
        digitalAssets: arr(ref('asset'), L.assets),
        exemptedData: arr(ref('exempted'), L.exempted),
        interfaces: arr(ref('interface'), L.interfaces),
        switchingMethods: arr(ref('shortText'), L.textItems),
        knownRestrictions: arr(ref('shortText'), L.textItems),
        standards: arr(ref('shortText'), L.textItems),
        functionalEquivalence: strict({ capabilities: bool, information: bool, documentation: bool, technicalSupport: bool, tools: arr(ref('shortText'), L.textItems) }),
        unbundling: enumOf(UNBUNDLING),
        unbundlingNote: ref('longText'),
        freeTier: bool,
        estimatedSwitchingTime: ref('shortText'),
        complexSwitchingInfo: ref('longText'),
      },
      ['id', 'name', 'deliveryModel'],
    ),
    contract: strict({
      ...Object.fromEntries(CONTRACT_FLAGS.map((k) => [k, bool])),
      transitionDays: { type: 'integer', minimum: 1, maximum: L.maxDays },
      retrievalDays: { type: 'integer', minimum: 0, maximum: L.maxDays },
      unfeasibilityNoticeWorkingDays: { type: 'integer', minimum: 0, maximum: 365 },
      maxAlternativeTransitionMonths: { type: 'integer', minimum: 0, maximum: 120 },
      noticePeriod: {
        type: 'object',
        additionalProperties: false,
        required: ['unit', 'value'],
        properties: { unit: enumOf(['days', 'months']), value: { type: 'integer', minimum: 0, maximum: L.maxDays } },
        if: { properties: { unit: { const: 'months' } } },
        then: { properties: { value: { type: 'integer', maximum: 120 } } },
      },
      clauseRefs: {
        type: 'object',
        additionalProperties: false,
        properties: Object.fromEntries([...CONTRACT_FLAGS, 'transitionDays', 'retrievalDays', 'unfeasibilityNoticeWorkingDays', 'maxAlternativeTransitionMonths', 'noticePeriod'].map((k) => [k, textDef(L.clauseRef, false)])),
      },
    }),
    information: strict({
      switchingProcedures: ref('longText'),
      onlineRegisterUrl: ref('url'),
      chargesInformationUrl: ref('url'),
      registerCoversDataStructures: bool,
      registerCoversDataFormats: bool,
      registerCoversStandards: bool,
      registerCoversOpenInteroperabilitySpecifications: bool,
      preContractStandardServiceFees: bool,
      preContractEarlyTerminationPenalties: bool,
      preContractReducedSwitchingCharges: bool,
      exemptionsInformedBeforeContract: bool,
    }),
    charge: strict(
      {
        id: ref('id'),
        name: ref('name'),
        kind: enumOf(CHARGE_KINDS),
        amountMinor: ref('amountMinor'),
        unit: ref('name'),
        directlyLinkedCostMinor: ref('amountMinor'),
        costBasis: ref('longText'),
        appliesFrom: ref('date'),
        appliesUntil: ref('date'),
        serviceIds: arr(ref('id'), L.services),
        onlyOnCustomerRequest: bool,
        priceAgreedInAdvance: bool,
      },
      ['id', 'name', 'kind', 'amountMinor'],
    ),
  },
};

const eventBase = { type: {}, at: ref('instant'), note: ref('longText') } as const;

function event(type: string, extra: Record<string, Json>, required: readonly string[] = []): Json {
  return strict({ ...eventBase, type: { const: type }, ...extra }, ['type', 'at', ...required]);
}

/** JSON Schema of the switching request (also the export/import format, inside the exchange envelope). */
export const SWITCHING_REQUEST_SCHEMA: Json = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: REQUEST_SCHEMA_ID,
  title: 'Offramp switching request',
  description: 'A switching request under Article 25(3) of Regulation (EU) 2023/2854 and the events that followed.',
  ...(strict(
    {
      $schema: { type: 'string', maxLength: 2048 },
      format: { const: REQUEST_FORMAT },
      version: { const: 1 },
      id: ref('id'),
      provider: ref('name'),
      profileDigest: { type: 'string', pattern: '^[0-9a-f]{64}$' },
      customer: strict({ name: ref('name'), reference: ref('name'), contactEmail: ref('email') }, ['name']),
      serviceIds: arr(ref('id'), L.services, { minItems: 1, uniqueItems: true }),
      target: {
        oneOf: [
          strict({ kind: { const: 'provider' }, providerName: ref('name'), details: ref('longText') }, ['kind', 'providerName']),
          strict({ kind: { const: 'on-premises' }, details: ref('longText') }, ['kind']),
          strict({ kind: { const: 'erase' } }, ['kind']),
        ],
      },
      data: strict({ categoryIds: arr(ref('id'), REQUEST_LIMITS.ids, { uniqueItems: true }), assetIds: arr(ref('id'), REQUEST_LIMITS.ids, { uniqueItems: true }) }),
      receivedAt: ref('instant'),
      transitionStartDate: ref('date'),
      retrievalDays: { type: 'integer', minimum: 1, maximum: L.maxDays },
      erasureNotBefore: ref('date'),
      events: arr(ref('event'), REQUEST_LIMITS.events),
      charges: arr(ref('appliedCharge'), REQUEST_LIMITS.charges),
      notes: ref('longText'),
    },
    ['format', 'version', 'id', 'provider', 'customer', 'serviceIds', 'target', 'data', 'receivedAt'],
  ) as Record<string, Json>),
  $defs: {
    ...commonDefs,
    longText: textDef(REQUEST_LIMITS.notes, true),
    instant: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$', description: 'UTC timestamp as produced by Date.prototype.toISOString().' },
    event: {
      oneOf: [
        event(EVENT_TYPES[0], { reasons: textDef(REQUEST_LIMITS.reasons, true), alternativeTransitionEnd: ref('date') }, ['reasons', 'alternativeTransitionEnd']),
        event(EVENT_TYPES[1], { newTransitionEnd: ref('date') }, ['newTransitionEnd']),
        event(EVENT_TYPES[2], {}),
        event(EVENT_TYPES[3], {}),
        event(EVENT_TYPES[4], { scope: ref('longText') }),
        event(EVENT_TYPES[5], { reason: ref('longText') }),
      ],
    },
    appliedCharge: strict(
      {
        id: ref('id'),
        chargeId: ref('id'),
        kind: enumOf(CHARGE_KINDS),
        description: ref('longText'),
        amountMinor: ref('amountMinor'),
        directlyLinkedCostMinor: ref('amountMinor'),
        imposedOn: ref('date'),
        customerRequested: bool,
        priceAgreedInAdvance: bool,
      },
      ['id', 'kind', 'amountMinor', 'imposedOn'],
    ),
  },
};

/** The schema file contents, as written to `schema/`. */
export function schemaText(which: 'profile' | 'request'): string {
  return `${JSON.stringify(which === 'profile' ? PROVIDER_PROFILE_SCHEMA : SWITCHING_REQUEST_SCHEMA, null, 2)}\n`;
}
