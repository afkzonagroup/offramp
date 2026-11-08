// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { addEvent, createRequest } from '../src/engine/lifecycle.ts';
import type { SwitchingRequest } from '../src/model/request.ts';
import { OfframpError } from '../src/util/errors.ts';
import { digest } from '../src/util/json.ts';
import { ms, profile, request } from './helpers.ts';

const P = profile();
const NOW = ms('2027-12-31T00:00:00Z');

function add(req: SwitchingRequest, event: Record<string, unknown>, now = NOW): SwitchingRequest {
  return addEvent(P, req, event, now);
}

function conflict(fn: () => unknown, message: RegExp): void {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(OfframpError);
    expect((err as OfframpError).code).toBe('CONFLICT');
    expect((err as OfframpError).message).toMatch(message);
    return;
  }
  throw new Error('expected a conflict');
}

describe('createRequest', () => {
  const base = { id: 'SR-9', customer: { name: 'Customer' }, serviceIds: ['crm'], target: { kind: 'provider', providerName: 'Dest' }, receivedAt: '2026-10-30T08:00:00.000Z' } as const;

  it('includes every exportable category and asset of the chosen services by default', () => {
    const r = createRequest(P, base);
    expect(r.data.categoryIds).toEqual(['crm-records', 'crm-files', 'crm-reports', 'crm-audit']);
    expect(r.data.assetIds).toEqual(['crm-workflows', 'crm-roles']);
    expect(r.profileDigest).toBe(digest(P));
    expect(r.provider).toBe('Example Cloud');
    expect(r.events).toEqual([]);
  });

  it('chooses nothing for erase-only requests and keeps explicit choices', () => {
    expect(createRequest(P, { ...base, target: { kind: 'erase' } }).data).toEqual({ categoryIds: [], assetIds: [] });
    expect(createRequest(P, { ...base, data: { categoryIds: ['crm-records'], assetIds: [] } }).data.categoryIds).toEqual(['crm-records']);
  });

  it('keeps optional agreements', () => {
    const r = createRequest(P, { ...base, transitionStartDate: '2027-01-04', retrievalDays: 60, erasureNotBefore: '2027-06-01', notes: 'n' });
    expect(r).toMatchObject({ transitionStartDate: '2027-01-04', retrievalDays: 60, erasureNotBefore: '2027-06-01', notes: 'n' });
  });

  it('refuses unknown services, data of other services and exempted data', () => {
    expect(() => createRequest(P, { ...base, serviceIds: ['nope'] })).toThrow(/unknown service/);
    expect(() => createRequest(P, { ...base, data: { categoryIds: ['vm-disks'], assetIds: [] } })).toThrow(/unknown data category/);
    expect(() => createRequest(P, { ...base, serviceIds: ['vm'], data: { categoryIds: ['vm-scheduler'], assetIds: [] } })).toThrow(/exempted category/);
    expect(() => createRequest(P, { ...base, data: { categoryIds: [], assetIds: ['vm-images'] } })).toThrow(/unknown digital asset/);
    expect(() => createRequest(P, { ...base, id: '../x' })).toThrow(/identifier/);
  });
});

describe('addEvent', () => {
  const r0 = request({ receivedAt: '2026-10-30T08:00:00.000Z' });

  it('appends an event without changing the input', () => {
    const r1 = add(r0, { type: 'transition-started', at: '2026-12-31T08:00:00.000Z' });
    expect(r1.events).toHaveLength(1);
    expect(r0.events).toHaveLength(0);
  });

  it('refuses future events, events before the request and out-of-order events', () => {
    conflict(() => add(r0, { type: 'transition-started', at: '2026-12-31T08:00:00.000Z' }, ms('2026-12-01T00:00:00Z')), /future/);
    conflict(() => add(r0, { type: 'cancelled', at: '2026-10-29T08:00:00.000Z' }), /before the switching request/);
    const r1 = add(r0, { type: 'transition-started', at: '2026-12-31T08:00:00.000Z' });
    conflict(() => add(r1, { type: 'switching-completed', at: '2026-12-30T08:00:00.000Z' }), /before the last recorded event/);
  });

  it('records each event type once', () => {
    const r1 = add(r0, { type: 'transition-started', at: '2026-12-31T08:00:00.000Z' });
    conflict(() => add(r1, { type: 'transition-started', at: '2027-01-01T08:00:00.000Z' }), /once/);
  });

  it('validates the event structure', () => {
    expect(() => add(r0, { type: 'unknown', at: '2026-12-31T08:00:00.000Z' })).toThrow(/must be one of/);
    expect(() => add(r0, { type: 'transition-started', at: 'yesterday' })).toThrow(/UTC timestamp/);
    expect(() => add(r0, { type: 'transition-started', at: '2026-12-31T08:00:00.000Z', extra: 1 })).toThrow(/unknown property/);
  });

  describe('technical unfeasibility (Art. 25(4))', () => {
    const ev = (alt: string, at = '2026-11-10T08:00:00.000Z'): Record<string, unknown> => ({ type: 'unfeasibility-notified', at, reasons: 'Volume', alternativeTransitionEnd: alt });

    it('accepts an alternative period up to seven months', () => {
      expect(add(r0, ev('2027-07-30')).events[0]?.type).toBe('unfeasibility-notified');
    });

    it('refuses more than seven months, a period not longer than 30 days, and erase-only requests', () => {
      conflict(() => add(r0, ev('2027-07-31')), /seven|7 months.*2027-07-30/);
      conflict(() => add(r0, ev('2027-01-29')), /after the standard one/);
      conflict(() => add(request({ target: { kind: 'erase' }, data: { categoryIds: [], assetIds: [] } }), ev('2027-03-01')), /erase-only/);
    });

    it('accepts a late notification (the timeline flags it) but not after the transitional period', () => {
      expect(add(r0, ev('2027-03-01', '2026-12-01T08:00:00.000Z')).events).toHaveLength(1);
      conflict(() => add(r0, ev('2027-03-01', '2027-01-30T08:00:00.000Z')), /already ended/);
    });

    it('is refused after completion', () => {
      const done = add(r0, { type: 'switching-completed', at: '2026-11-05T08:00:00.000Z' });
      conflict(() => add(done, ev('2027-03-01', '2026-11-06T08:00:00.000Z')), /already completed/);
    });
  });

  describe("customer's extension (Art. 25(5))", () => {
    it('accepts one extension to a later day, before the transitional period ends', () => {
      const r1 = add(r0, { type: 'customer-extension', at: '2027-01-29T21:00:00.000Z', newTransitionEnd: '2027-03-31' });
      expect(r1.events).toHaveLength(1);
      conflict(() => add(r1, { type: 'customer-extension', at: '2027-02-01T08:00:00.000Z', newTransitionEnd: '2027-04-30' }), /once/);
    });

    it('refuses an extension after the end or to an earlier day', () => {
      conflict(() => add(r0, { type: 'customer-extension', at: '2027-01-29T22:00:00.000Z', newTransitionEnd: '2027-03-31' }), /ended on 2027-01-29/);
      conflict(() => add(r0, { type: 'customer-extension', at: '2026-11-02T08:00:00.000Z', newTransitionEnd: '2027-01-29' }), /after the current end/);
      conflict(() => add(request({ target: { kind: 'erase' } }), { type: 'customer-extension', at: '2026-11-02T08:00:00.000Z', newTransitionEnd: '2027-03-31' }), /erase-only/);
      const done = add(r0, { type: 'switching-completed', at: '2026-11-05T08:00:00.000Z' });
      conflict(() => add(done, { type: 'customer-extension', at: '2026-11-06T08:00:00.000Z', newTransitionEnd: '2027-03-31' }), /already completed/);
    });

    it('allows extending after a provider alternative period, measured from the new end', () => {
      const r1 = add(r0, { type: 'unfeasibility-notified', at: '2026-11-10T08:00:00.000Z', reasons: 'r', alternativeTransitionEnd: '2027-04-30' });
      conflict(() => add(r1, { type: 'customer-extension', at: '2026-11-11T08:00:00.000Z', newTransitionEnd: '2027-04-30' }), /2027-04-30/);
      expect(add(r1, { type: 'customer-extension', at: '2027-04-30T08:00:00.000Z', newTransitionEnd: '2027-05-31' }).events).toHaveLength(2);
    });
  });

  describe('completion, erasure and cancellation', () => {
    it('refuses switching events on erase-only requests', () => {
      const erase = request({ target: { kind: 'erase' }, data: { categoryIds: [], assetIds: [] } });
      conflict(() => add(erase, { type: 'switching-completed', at: '2026-11-05T08:00:00.000Z' }), /no switching/);
      conflict(() => add(erase, { type: 'transition-started', at: '2026-11-05T08:00:00.000Z' }), /no switching/);
    });

    it('requires completion before erasure (Art. 25(2)(h))', () => {
      conflict(() => add(r0, { type: 'erasure-confirmed', at: '2027-03-01T08:00:00.000Z' }), /completion of switching first/);
      const done = add(r0, { type: 'switching-completed', at: '2027-01-10T08:00:00.000Z' });
      expect(add(done, { type: 'erasure-confirmed', at: '2027-03-01T08:00:00.000Z', scope: 'All' }).events).toHaveLength(2);
    });

    it('refuses withdrawing an erase-only request after its contract ended', () => {
      const erase = request({ target: { kind: 'erase' }, data: { categoryIds: [], assetIds: [] } });
      expect(add(erase, { type: 'cancelled', at: '2026-12-30T21:59:59.999Z' }).events).toHaveLength(1);
      conflict(() => add(erase, { type: 'cancelled', at: '2026-12-30T22:00:00.000Z' }), /no longer be withdrawn/);
    });

    it('erases erase-only requests only after the contract ends', () => {
      const erase = request({ target: { kind: 'erase' }, data: { categoryIds: [], assetIds: [] } });
      conflict(() => add(erase, { type: 'erasure-confirmed', at: '2026-12-30T21:59:59.999Z' }), /2026-12-30/);
      expect(add(erase, { type: 'erasure-confirmed', at: '2026-12-30T22:00:00.000Z' }).events).toHaveLength(1);
    });

    it('closes the request after erasure or cancellation', () => {
      const done = add(r0, { type: 'switching-completed', at: '2027-01-10T08:00:00.000Z' });
      const erased = add(done, { type: 'erasure-confirmed', at: '2027-03-01T08:00:00.000Z' });
      conflict(() => add(erased, { type: 'cancelled', at: '2027-03-02T08:00:00.000Z' }), /closed/);
      const cancelled = add(r0, { type: 'cancelled', at: '2026-11-02T08:00:00.000Z', reason: 'Stays' });
      conflict(() => add(cancelled, { type: 'transition-started', at: '2026-11-03T08:00:00.000Z' }), /cancelled/);
      conflict(() => add(done, { type: 'cancelled', at: '2027-01-11T08:00:00.000Z' }), /no longer be cancelled/);
    });
  });
});
