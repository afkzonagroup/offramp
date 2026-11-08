// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { exportRequest, importRequest } from '../src/connectors/exchange.ts';
import { PROVIDER_PROFILE_SCHEMA, SWITCHING_REQUEST_SCHEMA, schemaText } from '../src/connectors/schema.ts';
import { EXAMPLE_PROFILE } from '../src/example.ts';
import { EXAMPLE_REQUEST } from '../src/example-request.ts';
import { validateProfile } from '../src/model/parse-profile.ts';
import { checkRequestAgainstProfile, validateRequest } from '../src/model/parse-request.ts';
import { digest } from '../src/util/json.ts';
import { clone, ms, profile, rawProfile, request } from './helpers.ts';

const ROOT = join(import.meta.dirname, '..');
const ajv = new Ajv2020({ strict: true, allErrors: true, allowUnionTypes: true });
const checkProfileSchema = ajv.compile(PROVIDER_PROFILE_SCHEMA as object);
const checkRequestSchema = ajv.compile(SWITCHING_REQUEST_SCHEMA as object);

function validatorAccepts(fn: () => unknown): boolean {
  try {
    fn();
    return true;
  } catch {
    return false;
  }
}

describe('JSON schemas', () => {
  it('are valid draft 2020-12 schemas and match the committed files', () => {
    expect(readFileSync(join(ROOT, 'schema/provider-profile.schema.json'), 'utf8')).toBe(schemaText('profile'));
    expect(readFileSync(join(ROOT, 'schema/switching-request.schema.json'), 'utf8')).toBe(schemaText('request'));
  });

  it('match the committed examples', () => {
    expect(JSON.parse(readFileSync(join(ROOT, 'examples/provider-profile.json'), 'utf8'))).toEqual(EXAMPLE_PROFILE);
    expect(JSON.parse(readFileSync(join(ROOT, 'examples/switching-request.json'), 'utf8'))).toEqual(EXAMPLE_REQUEST);
  });

  it('accept the examples, like the validators', () => {
    expect(checkProfileSchema(EXAMPLE_PROFILE), JSON.stringify(checkProfileSchema.errors)).toBe(true);
    expect(checkRequestSchema(EXAMPLE_REQUEST), JSON.stringify(checkRequestSchema.errors)).toBe(true);
    const r = validateRequest(EXAMPLE_REQUEST);
    expect(() => { checkRequestAgainstProfile(r, validateProfile(EXAMPLE_PROFILE)); }).not.toThrow();
  });

  const profileCases: Record<string, unknown>[] = [
    {},
    { 'services.0.regime': undefined },
    { contract: undefined, information: undefined, charges: undefined, internationalAccess: undefined, workingDays: undefined },
    { format: 'x' },
    { version: 2 },
    { extra: 1 },
    { 'provider.name': '' },
    { 'provider.name': '   ' },
    { 'provider.name': 'Evil\u202eCorp' },
    { 'provider.name': 'Two\nlines' },
    { 'provider.name': 'a'.repeat(201) },
    { 'provider.website': 'javascript:alert(1)' },
    { 'provider.contactEmail': 'nobody' },
    { services: [] },
    { 'services.0.id': '../x' },
    { 'services.0.deliveryModel': 'faas' },
    { 'services.0.unknown': true },
    { 'contract.transitionDays': 0 },
    { 'contract.transitionDays': 2.5 },
    { 'contract.noticePeriod': { unit: 'weeks', value: 1 } },
    { 'contract.noticePeriod': { unit: 'months', value: 121 } },
    { 'contract.noticePeriod': { unit: 'days', value: 3650 } },
    { 'contract.clauseRefs': { other: 'x' } },
    { 'charges.currency': 'eur' },
    { 'charges.items.0.amountMinor': -1 },
    { 'charges.items.0.kind': 'gift' },
    { 'workingDays.publicHolidays': ['2026-13-01'] },
    { 'information.onlineRegisterUrl': 'ftp://example.com/x' },
    { 'information.onlineRegisterUrl': 'https://example.com?x=1' },
    { 'information.onlineRegisterUrl': 'https://example.com#a' },
    { 'services.1.exportableData.0.formats.0.mediaType': 'csv' },
  ];

  it.each(profileCases)('agree with the profile validator on %j', (changes) => {
    const p = rawProfile(changes);
    expect(checkProfileSchema(p)).toBe(validatorAccepts(() => validateProfile(p)));
  });

  const requestCases: Record<string, unknown>[] = [
    {},
    { id: '.x' },
    { receivedAt: '2026-10-30' },
    { serviceIds: [] },
    { serviceIds: ['a', 'a'] },
    { target: { kind: 'provider' } },
    { target: { kind: 'on-premises' } },
    { target: { kind: 'erase', details: 'x' } },
    { data: { categoryIds: ['a', 'a'], assetIds: [] } },
    { events: [{ type: 'transition-started', at: '2026-12-31T00:00:00.000Z' }] },
    { events: [{ type: 'unfeasibility-notified', at: '2026-11-01T00:00:00.000Z', reasons: 'r', alternativeTransitionEnd: '2027-03-01' }] },
    { events: [{ type: 'unfeasibility-notified', at: '2026-11-01T00:00:00.000Z', reasons: 'r' }] },
    { events: [{ type: 'customer-extension', at: '2026-11-01T00:00:00.000Z', newTransitionEnd: '2027-03-01', extra: 1 }] },
    { events: [{ type: 'wrong', at: '2026-11-01T00:00:00.000Z' }] },
    { charges: [{ id: 'c', kind: 'data-egress', amountMinor: 1, imposedOn: '2027-01-12' }] },
    { charges: [{ id: 'c', kind: 'data-egress', amountMinor: 1 }] },
    { profileDigest: 'xyz' },
    { notes: 'x'.repeat(4001) },
  ];

  it.each(requestCases)('agree with the request validator on %j', (overrides) => {
    const r = { ...clone(EXAMPLE_REQUEST), ...overrides };
    expect(checkRequestSchema(r)).toBe(validatorAccepts(() => validateRequest(r)));
  });
});

describe('request exchange format', () => {
  const NOW = ms('2026-11-08T10:00:00Z');

  it('round-trips a request', () => {
    const r = request({ events: [{ type: 'cancelled', at: '2026-11-01T00:00:00.000Z' }] });
    const text = exportRequest(r, NOW);
    const env = JSON.parse(text) as Record<string, unknown>;
    expect(env).toMatchObject({ format: 'offramp/switching-request-export', version: 1, exportedAt: '2026-11-08T10:00:00.000Z', sha256: digest(r) });
    expect(String(env.generator)).toContain('Offramp by AFKzona Group');
    const back = importRequest(text, profile());
    expect(back.request).toEqual(r);
    expect(back.warnings).toEqual([]);
  });

  it('detects changes and truncation', () => {
    const text = exportRequest(request(), NOW);
    expect(() => importRequest(text.replace('"Customer"', '"Mallory"'))).toThrow(/changed or is incomplete/);
    expect(() => importRequest(text.slice(0, -20))).toThrow(/not valid JSON/);
    const env = JSON.parse(text) as Record<string, unknown>;
    expect(() => importRequest(JSON.stringify({ ...env, format: 'x' }))).toThrow(expect.objectContaining({ path: '$.format' }));
    expect(() => importRequest(JSON.stringify({ ...env, version: 2 }))).toThrow(expect.objectContaining({ path: '$.version' }));
    expect(() => importRequest(JSON.stringify({ ...env, exportedAt: 'now' }))).toThrow(expect.objectContaining({ path: '$.exportedAt' }));
    expect(() => importRequest(JSON.stringify({ ...env, sha256: 'ABC' }))).toThrow(expect.objectContaining({ path: '$.sha256' }));
    expect(() => importRequest(JSON.stringify({ ...env, extra: 1 }))).toThrow(/unknown property/);
    expect(() => importRequest(text.replace('"request": {', '"request": {"__proto__": {"polluted": true},'))).toThrow(/forbidden key "__proto__"/);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('refuses an export whose event log breaks the lifecycle rules, even with a matching digest', () => {
    const env = JSON.parse(exportRequest(request(), NOW)) as Record<string, unknown>;
    const bad = { ...(env.request as Record<string, unknown>), events: [
      { type: 'customer-extension', at: '2026-11-01T08:00:00.000Z', newTransitionEnd: '2027-02-15' },
      { type: 'customer-extension', at: '2026-11-02T08:00:00.000Z', newTransitionEnd: '2027-12-31' },
    ] };
    expect(() => importRequest(JSON.stringify({ ...env, request: bad, sha256: digest(bad) }), profile())).toThrow(/more than once/);
    const early = { ...(env.request as Record<string, unknown>), events: [{ type: 'switching-completed', at: '2025-01-01T08:00:00.000Z' }] };
    expect(() => importRequest(JSON.stringify({ ...env, request: early, sha256: digest(early) }))).toThrow(/before the switching request/);
  });

  it('checks references and warns when the profile changed', () => {
    const r = request({ profileDigest: digest(profile()) });
    expect(importRequest(exportRequest(r, NOW), profile()).warnings).toEqual([]);
    expect(importRequest(exportRequest(r, NOW), profile({ 'contract.retrievalDays': 45 })).warnings[0]).toMatch(/changed/);
    expect(() => importRequest(exportRequest(request({ serviceIds: ['nope'] }), NOW), profile())).toThrow(/unknown service/);
  });
});
