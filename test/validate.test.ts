// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { parseProfile, validateProfile } from '../src/model/parse-profile.ts';
import { checkRequestAgainstProfile, parseRequest, validateRequest } from '../src/model/parse-request.ts';
import { OfframpError, publicMessage } from '../src/util/errors.ts';
import { canonicalJson, digest, MAX_JSON_BYTES, MAX_JSON_DEPTH, parseJson } from '../src/util/json.ts';
import { printable } from '../src/util/validate.ts';
import { profile, rawProfile, request } from './helpers.ts';

function err(fn: () => unknown): OfframpError {
  try {
    fn();
  } catch (e) {
    if (e instanceof OfframpError) return e;
    throw e;
  }
  throw new Error('expected an error');
}

describe('safe JSON parsing', () => {
  it('rejects prototype-polluting keys anywhere', () => {
    expect(() => parseJson('{"__proto__":{"x":1}}')).toThrow(/forbidden key "__proto__"/);
    expect(() => parseJson('{"a":{"constructor":{"prototype":{}}}}')).toThrow(/forbidden key/);
    expect(({} as Record<string, unknown>).x).toBeUndefined();
  });

  it('enforces size and depth limits', () => {
    expect(() => parseJson(`"${'a'.repeat(MAX_JSON_BYTES)}"`)).toThrow(/larger than/);
    const deep = `${'['.repeat(MAX_JSON_DEPTH + 2)}${']'.repeat(MAX_JSON_DEPTH + 2)}`;
    expect(() => parseJson(deep)).toThrow(/nested/);
    expect(parseJson(`${'['.repeat(MAX_JSON_DEPTH)}${']'.repeat(MAX_JSON_DEPTH)}`)).toBeDefined();
  });

  it('refuses very deep nesting within the size limit with its own error, not a stack overflow', () => {
    for (const open of ['[', '{"a":']) {
      const n = Math.floor(MAX_JSON_BYTES / (open.length + 1)) - 10;
      const text = `${open.repeat(n)}1${(open === '[' ? ']' : '}').repeat(n)}`;
      expect(Buffer.byteLength(text)).toBeLessThanOrEqual(MAX_JSON_BYTES);
      let thrown: unknown;
      try {
        parseJson(text);
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(OfframpError);
      expect((thrown as Error).message).toMatch(/nested/);
    }
    // Brackets inside strings, including after escaped quotes, do not count.
    expect(parseJson(JSON.stringify({ a: '['.repeat(1000), b: '\\"{'.repeat(500) }))).toBeDefined();
  });

  it('reports syntax errors without echoing the input', () => {
    expect(() => parseJson('{oops', 'Profile')).toThrow('Profile is not valid JSON.');
  });

  it('gives canonical JSON and stable digests', () => {
    expect(canonicalJson({ b: 1, a: [true, null, 'x'], c: undefined })).toBe('{"a":[true,null,"x"],"b":1}');
    expect(digest({ a: 1, b: 2 })).toBe(digest({ b: 2, a: 1 }));
    expect(() => canonicalJson(Number.NaN)).toThrow(/finite/);
    expect(() => canonicalJson(() => 1)).toThrow(/cannot be represented/);
  });
});

describe('provider profile validation', () => {
  it('accepts the example and parses JSON text', () => {
    expect(profile().provider.name).toBe('Example Cloud');
    expect(parseProfile(JSON.stringify(rawProfile())).services).toHaveLength(2);
  });

  it('defaults the regime to standard', () => {
    expect(profile({ 'services.0.regime': undefined }).services[0]?.regime).toBe('standard');
  });

  it.each([
    [{ format: 'other' }, '$.format'],
    [{ version: 2 }, '$.version'],
    [{ surprise: true }, '$'],
    [{ 'provider.name': '' }, '$.provider.name'],
    [{ 'provider.name': '   ' }, '$.provider.name'],
    [{ 'provider.name': 'a'.repeat(201) }, '$.provider.name'],
    [{ 'provider.name': 'Evil\u202eCorp' }, '$.provider.name'],
    [{ 'provider.name': 'Zero\u200bwidth' }, '$.provider.name'],
    [{ 'provider.name': 'Two\nlines' }, '$.provider.name'],
    [{ 'provider.name': 'Bell\u0007' }, '$.provider.name'],
    [{ 'provider.website': 'javascript:alert(1)' }, '$.provider.website'],
    [{ 'provider.website': 'ftp://example.com/x' }, '$.provider.website'],
    [{ 'provider.website': 'file:///etc/passwd' }, '$.provider.website'],
    [{ 'provider.website': 'https://user:pw@example.com' }, '$.provider.website'],
    [{ 'provider.website': 'not a url' }, '$.provider.website'],
    [{ 'provider.contactEmail': 'nobody' }, '$.provider.contactEmail'],
    [{ timeZone: 'Mars/Base' }, '$.timeZone'],
    [{ services: [] }, '$.services'],
    [{ 'services.0.id': '../etc' }, '$.services[0].id'],
    [{ 'services.0.id': 'crm' }, '$.services[1]'],
    [{ 'services.0.deliveryModel': 'faas' }, '$.services[0].deliveryModel'],
    [{ 'services.0.exportableData.0.id': 'vm-scheduler' }, '$.services[0].exportableData|digitalAssets|exemptedData[3]'],
    [{ 'services.0.exportableData.0.formats.0.mediaType': 'not a type' }, '$.services[0].exportableData[0].formats[0].mediaType'],
    [{ 'services.0.exemptedData.0.tradeSecretRisk': 'yes' }, '$.services[0].exemptedData[0].tradeSecretRisk'],
    [{ 'contract.transitionDays': 0 }, '$.contract.transitionDays'],
    [{ 'contract.transitionDays': 1.5 }, '$.contract.transitionDays'],
    [{ 'contract.noticePeriod': { unit: 'weeks', value: 2 } }, '$.contract.noticePeriod.unit'],
    [{ 'contract.noticePeriod': { unit: 'months', value: 121 } }, '$.contract.noticePeriod.value'],
    [{ 'contract.clauseRefs': { unknownClause: '1' } }, '$.contract.clauseRefs'],
    [{ 'workingDays.publicHolidays': ['2026-02-30'] }, '$.workingDays.publicHolidays[0]'],
    [{ 'charges.currency': 'eur' }, '$.charges.currency'],
    [{ 'charges.items.0.amountMinor': -1 }, '$.charges.items[0].amountMinor'],
    [{ 'charges.items.0.appliesFrom': '2027-02-01' }, '$.charges.items[0].appliesUntil'],
    [{ 'charges.items.0.serviceIds': ['nope'] }, '$.charges.items[0].serviceIds[0]'],
    [{ 'charges.items.1.id': 'egress' }, '$.charges.items[1]'],
  ])('rejects %j at %s', (changes, path) => {
    const e = err(() => validateProfile(rawProfile(changes)));
    expect(e.code).toBe('INVALID');
    expect(e.path).toBe(path);
    expect(publicMessage(e)).toContain(path);
  });

  it('reads only own properties of plain objects', () => {
    // Values inherited through a prototype must not pass as profile data.
    expect(err(() => validateProfile(Object.create(rawProfile()) as unknown)).message).toBe('must be an object.');
    expect(err(() => validateRequest(Object.create(request()) as unknown)).message).toBe('must be an object.');
    expect(validateProfile(Object.assign(Object.create(null) as object, rawProfile())).provider.name).toBe('Example Cloud');
  });

  it('rejects non-objects and limits list sizes', () => {
    expect(err(() => validateProfile([])).path).toBe('$');
    expect(err(() => validateProfile(null)).path).toBe('$');
    const many = Array.from({ length: 101 }, (_, i) => ({ id: `s${i}`, name: 'S', deliveryModel: 'saas' }));
    expect(err(() => validateProfile(rawProfile({ services: many }))).message).toMatch(/at most 100/);
  });
});

describe('switching request validation', () => {
  it('accepts a valid request and parses JSON text', () => {
    expect(parseRequest(JSON.stringify(request())).id).toBe('SR-T1');
  });

  it.each([
    [{ id: '' }, '$.id'],
    [{ id: '.hidden' }, '$.id'],
    [{ receivedAt: '2026-10-30' }, '$.receivedAt'],
    [{ serviceIds: [] }, '$.serviceIds'],
    [{ serviceIds: ['crm', 'crm'] }, '$.serviceIds[1]'],
    [{ target: { kind: 'provider' } }, '$.target.providerName'],
    [{ target: { kind: 'erase', providerName: 'x' } }, '$.target'],
    [{ target: { kind: 'cloud' } }, '$.target.kind'],
    [{ target: 'erase' }, '$.target'],
    [{ data: { categoryIds: ['a', 'a'] } }, '$.data.categoryIds[1]'],
    [{ events: [{ type: 'cancelled', at: '2026-11-01T00:00:00.000Z', reason: 'x', extra: 1 }] }, '$.events[0]'],
    [{ events: [{ type: 'unfeasibility-notified', at: '2026-11-01T00:00:00.000Z', reasons: 'x' }] }, '$.events[0].alternativeTransitionEnd'],
    [{ events: [{ type: 'customer-extension', at: '2026-11-01T00:00:00.000Z' }] }, '$.events[0].newTransitionEnd'],
    [{ events: ['x'] }, '$.events[0]'],
    [{ charges: [{ id: 'c', kind: 'data-egress', amountMinor: 1 }] }, '$.charges[0].imposedOn'],
    [{ charges: [{ id: 'c', kind: 'data-egress', amountMinor: 1, imposedOn: '2027-01-01' }, { id: 'c', kind: 'data-egress', amountMinor: 1, imposedOn: '2027-01-01' }] }, '$.charges[1]'],
    [{ profileDigest: 'ABC' }, '$.profileDigest'],
    [{ notes: 'x'.repeat(4001) }, '$.notes'],
    [{ retrievalDays: 0 }, '$.retrievalDays'],
    [{ receivedAt: '3000-01-01T00:00:00.000Z' }, '$.receivedAt'],
    [{ erasureNotBefore: '3000-01-01' }, '$.erasureNotBefore'],
  ])('rejects %j at %s', (overrides, path) => {
    const e = err(() => request(overrides));
    expect(e.path).toBe(path);
  });

  it('normalises Windows line breaks in multi-line text only', () => {
    expect(request({ notes: 'a\r\nb' }).notes).toBe('a\nb');
    expect(err(() => request({ notes: 'a\rb' })).path).toBe('$.notes');
  });

  it('accepts every event type', () => {
    const r = request({
      events: [
        { type: 'unfeasibility-notified', at: '2026-11-01T00:00:00.000Z', reasons: 'r', alternativeTransitionEnd: '2027-03-01', note: 'n' },
        { type: 'customer-extension', at: '2026-11-02T00:00:00.000Z', newTransitionEnd: '2027-04-01' },
        { type: 'transition-started', at: '2026-12-31T00:00:00.000Z' },
        { type: 'switching-completed', at: '2027-01-02T00:00:00.000Z' },
        { type: 'erasure-confirmed', at: '2027-06-02T00:00:00.000Z', scope: 'all' },
      ],
    });
    expect(r.events.map((e) => e.type)).toHaveLength(5);
    expect(request({ events: [{ type: 'cancelled', at: '2026-11-01T00:00:00.000Z', reason: 'r' }] }).events).toHaveLength(1);
  });

  it('refuses event logs that addEvent would refuse, so imported and hand-edited files follow the same rules', () => {
    const ext = (at: string, until: string): Record<string, unknown> => ({ type: 'customer-extension', at, newTransitionEnd: until });
    // Art. 25(5): one extension. A second one was silently ignored by the timeline before.
    expect(err(() => request({ events: [ext('2026-11-01T00:00:00.000Z', '2027-02-15'), ext('2026-11-02T00:00:00.000Z', '2027-12-31')] }))).toMatchObject({ path: '$.events[1]', message: expect.stringMatching(/more than once/) as unknown });
    expect(err(() => request({ events: [{ type: 'switching-completed', at: '2025-01-01T00:00:00.000Z' }] })).path).toBe('$.events[0].at');
    expect(err(() => request({ events: [ext('2026-11-02T00:00:00.000Z', '2027-02-15'), { type: 'switching-completed', at: '2026-11-01T00:00:00.000Z' }] })).path).toBe('$.events[1].at');
    expect(err(() => request({ events: [{ type: 'cancelled', at: '2026-11-01T00:00:00.000Z' }, ext('2026-11-02T00:00:00.000Z', '2027-02-15')] })).message).toMatch(/follows "cancelled"/);
    expect(err(() => request({ events: [{ type: 'switching-completed', at: '2026-11-01T00:00:00.000Z' }, { type: 'erasure-confirmed', at: '2026-12-01T00:00:00.000Z' }, { type: 'cancelled', at: '2026-12-02T00:00:00.000Z' }] })).message).toMatch(/follows "erasure-confirmed"/);
    const erase = { target: { kind: 'erase' }, data: { categoryIds: [], assetIds: [] } };
    expect(err(() => request({ ...erase, events: [{ type: 'switching-completed', at: '2026-11-01T00:00:00.000Z' }] })).message).toMatch(/erase-only/);
    expect(request({ ...erase, events: [{ type: 'erasure-confirmed', at: '2027-01-01T00:00:00.000Z' }] }).events).toHaveLength(1);
    // Same instant as the request and equal times are in order.
    expect(request({ events: [{ type: 'transition-started', at: '2026-10-30T08:00:00.000Z' }, { type: 'switching-completed', at: '2026-10-30T08:00:00.000Z' }] }).events).toHaveLength(2);
  });

  it('checks references against the profile', () => {
    const p = profile();
    expect(() => { checkRequestAgainstProfile(request({ provider: 'Other' }), p); }).toThrow(/profile is for/);
    expect(() => { checkRequestAgainstProfile(request({ charges: [{ id: 'c', chargeId: 'nope', kind: 'data-egress', amountMinor: 1, imposedOn: '2026-12-01' }] }), p); }).toThrow(/unknown charge item/);
    expect(() => { checkRequestAgainstProfile(request({ charges: [{ id: 'c', chargeId: 'egress', kind: 'switching', amountMinor: 1, imposedOn: '2026-12-01' }] }), p); }).toThrow(/differs/);
    expect(() => { checkRequestAgainstProfile(request({ charges: [{ id: 'c', kind: 'switching', amountMinor: 1, imposedOn: '2026-12-01' }] }), p); }).not.toThrow();
  });

  it('validates the request object passed to validateRequest', () => {
    expect(validateRequest(request()).id).toBe('SR-T1');
  });
});

describe('messages', () => {
  it('hides unknown errors and makes text printable', () => {
    expect(publicMessage(new Error('secret path /home/x'))).toBe('Unexpected internal error.');
    expect(publicMessage(new OfframpError('INVALID', 'Bad.'))).toBe('Bad.');
    expect(printable('a\u001b[31mred\u202e')).toBe('a\\u{1b}[31mred\\u{202e}');
    expect(printable('x'.repeat(10), 4)).toBe('xxxx…');
  });
});
