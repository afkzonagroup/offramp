// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { checkAppliedCharges, checkChargeSchedule, chargePhase, isSwitchingCharge, LAST_REDUCED_CHARGE_DAY } from '../src/rules/charges.ts';
import type { Finding } from '../src/rules/findings.ts';
import { profile, request } from './helpers.ts';

function schedule(items: unknown[], extra: Record<string, unknown> = {}): Finding[] {
  return checkChargeSchedule(profile({ 'charges.items': items, ...extra }));
}

function applied(charges: unknown[], extra: Record<string, unknown> = {}, transitionLastDay?: string): Finding[] {
  return checkAppliedCharges(profile(extra), request({ charges }), transitionLastDay);
}

const codes = (f: readonly Finding[]): string[] => f.map((x) => x.code);

describe('Art. 29 phases', () => {
  it('switches on 12 September 2025 and 12 January 2027', () => {
    expect(chargePhase('2025-09-11')).toBe('before-application');
    expect(chargePhase('2025-09-12')).toBe('reduced');
    expect(chargePhase('2027-01-11')).toBe('reduced');
    expect(chargePhase('2027-01-12')).toBe('free');
    expect(chargePhase('2030-01-01')).toBe('free');
    expect(LAST_REDUCED_CHARGE_DAY).toBe('2027-01-11');
  });

  it('treats data egress as a switching charge, and fees and penalties as not', () => {
    expect(isSwitchingCharge('data-egress')).toBe(true);
    expect(isSwitchingCharge('switching')).toBe(true);
    expect(isSwitchingCharge('standard-service-fee')).toBe(false);
    expect(isSwitchingCharge('early-termination-penalty')).toBe(false);
    expect(isSwitchingCharge('parallel-use-egress')).toBe(false);
  });
});

describe('charge schedule of a profile', () => {
  const egress = { id: 'e', name: 'Egress', kind: 'data-egress', amountMinor: 5 };

  it('flags a switching charge that can apply on or after 12 January 2027', () => {
    expect(codes(schedule([{ ...egress, directlyLinkedCostMinor: 5, costBasis: 'x' }]))).toContain('charge-after-cutover');
    expect(codes(schedule([{ ...egress, directlyLinkedCostMinor: 5, costBasis: 'x', appliesUntil: '2027-01-12' }]))).toContain('charge-after-cutover');
    expect(codes(schedule([{ ...egress, directlyLinkedCostMinor: 5, costBasis: 'x', appliesUntil: '2027-01-11' }]))).not.toContain('charge-after-cutover');
    expect(codes(schedule([{ ...egress, kind: 'switching', appliesFrom: '2027-02-01' }]))).toEqual(['charge-after-cutover']);
  });

  it('never decides the cost basis: flags missing or exceeded stated costs', () => {
    const until = { appliesUntil: '2027-01-11' };
    expect(codes(schedule([{ ...egress, ...until }]))).toEqual(['charge-cost-not-stated']);
    expect(schedule([{ ...egress, ...until }])[0]?.severity).toBe('review');
    expect(codes(schedule([{ ...egress, ...until, directlyLinkedCostMinor: 4 }]))).toEqual(['charge-exceeds-cost']);
    expect(codes(schedule([{ ...egress, ...until, directlyLinkedCostMinor: 5 }]))).toEqual(['charge-cost-basis-not-documented']);
    const within = schedule([{ ...egress, ...until, directlyLinkedCostMinor: 5, costBasis: 'Transit invoices' }]);
    expect(within.map((f) => f.severity)).toEqual(['info']);
    expect(within[0]?.message).toMatch(/does not verify/);
  });

  it('ignores free switching items and items only before the Regulation applied', () => {
    expect(schedule([{ ...egress, amountMinor: 0 }])).toEqual([]);
    expect(schedule([{ ...egress, appliesUntil: '2025-09-11' }])).toEqual([]);
  });

  it('does not apply Art. 29 to custom-built or non-production services (Art. 31)', () => {
    const f = schedule([{ ...egress, serviceIds: ['crm'] }], { 'services.1.regime': 'custom-built', 'services.1.offeredAtBroadCommercialScale': false });
    expect(codes(f)).toEqual(['charge-art29-excluded']);
    // An item for all services still applies when one service is standard.
    expect(codes(schedule([{ ...egress }], { 'services.1.regime': 'custom-built' }))).toContain('charge-after-cutover');
    // A "custom-built" service offered at broad commercial scale does not meet Art. 31(1): Art. 29 applies.
    expect(codes(schedule([{ ...egress, serviceIds: ['crm'] }], { 'services.1.regime': 'custom-built', 'services.1.offeredAtBroadCommercialScale': true }))).toContain('charge-after-cutover');
  });

  it('caps egress for in-parallel use at costs incurred (Art. 34(2)) at any date', () => {
    const par = { id: 'p', name: 'Parallel egress', kind: 'parallel-use-egress', amountMinor: 3, appliesFrom: '2028-01-01' };
    expect(codes(schedule([par]))).toEqual(['parallel-egress-cost-not-stated']);
    expect(codes(schedule([{ ...par, directlyLinkedCostMinor: 2 }]))).toEqual(['parallel-egress-exceeds-cost']);
    expect(schedule([{ ...par, directlyLinkedCostMinor: 3 }]).filter((f) => f.severity !== 'info')).toHaveLength(1);
    expect(schedule([{ ...par, directlyLinkedCostMinor: 3, costBasis: 'x' }]).map((f) => f.severity)).toEqual(['info']);
  });

  it('asks for request and prior agreement on additional services (recital 89)', () => {
    const add = { id: 'a', name: 'Engineering', kind: 'additional-service', amountMinor: 9000 };
    expect(codes(schedule([add]))).toEqual(['additional-service-terms']);
    expect(schedule([{ ...add, onlyOnCustomerRequest: true, priceAgreedInAdvance: true }])).toEqual([]);
  });

  it('notes early termination penalties and leaves standard fees alone', () => {
    expect(codes(schedule([{ id: 'p', name: 'Penalty', kind: 'early-termination-penalty', amountMinor: 100 }]))).toEqual(['early-termination-penalty']);
    expect(schedule([{ id: 'f', name: 'Fee', kind: 'standard-service-fee', amountMinor: 100 }])).toEqual([]);
    expect(checkChargeSchedule(profile({ charges: undefined }))).toEqual([]);
  });
});

describe('charges imposed in a switching request', () => {
  const egress = { id: 'c1', kind: 'data-egress', amountMinor: 5000 };

  it('flags switching charges imposed from 12 January 2027', () => {
    expect(codes(applied([{ ...egress, imposedOn: '2027-01-12' }]))).toEqual(['charge-after-cutover']);
    expect(codes(applied([{ ...egress, kind: 'switching', imposedOn: '2027-06-01' }]))).toEqual(['charge-after-cutover']);
  });

  it('checks reduced charges before the cut-over against stated costs', () => {
    expect(codes(applied([{ ...egress, imposedOn: '2027-01-11' }]))).toEqual(['charge-cost-not-stated']);
    expect(codes(applied([{ ...egress, imposedOn: '2026-12-01', directlyLinkedCostMinor: 4999 }]))).toEqual(['charge-exceeds-cost']);
    expect(codes(applied([{ ...egress, imposedOn: '2026-12-01', directlyLinkedCostMinor: 5000 }]))).toEqual(['charge-cost-basis-not-documented']);
    // The cost basis of the linked schedule item counts as documentation.
    expect(applied([{ ...egress, chargeId: 'egress', imposedOn: '2026-12-01', directlyLinkedCostMinor: 5000 }]).map((f) => f.severity)).toEqual(['info']);
    expect(applied([{ ...egress, amountMinor: 0, imposedOn: '2027-02-01' }])).toEqual([]);
  });

  it('notes charges before the Regulation applied', () => {
    expect(codes(applied([{ ...egress, imposedOn: '2025-09-11' }]))).toEqual(['charge-before-application']);
  });

  it('notes excluded services, parallel-use egress, additional services and penalties', () => {
    expect(codes(applied([{ ...egress, imposedOn: '2027-02-01' }], { 'services.1.regime': 'custom-built' }))).toEqual(['charge-art29-excluded']);
    expect(codes(applied([{ ...egress, kind: 'parallel-use-egress', imposedOn: '2027-02-01' }]))).toEqual(['parallel-egress-in-switching']);
    expect(codes(applied([{ ...egress, kind: 'additional-service', imposedOn: '2027-02-01' }]))).toEqual(['additional-service-terms']);
    expect(applied([{ ...egress, kind: 'additional-service', imposedOn: '2027-02-01', customerRequested: true, priceAgreedInAdvance: true }])).toEqual([]);
    expect(codes(applied([{ ...egress, kind: 'early-termination-penalty', imposedOn: '2027-02-01' }]))).toEqual(['early-termination-penalty']);
  });

  it('asks about standard fees after the contract ended', () => {
    const fee = { id: 'f', kind: 'standard-service-fee', amountMinor: 4900, imposedOn: '2027-02-01' };
    expect(codes(applied([fee], {}, '2027-01-29'))).toEqual(['fee-after-contract-end']);
    expect(applied([fee], {}, '2027-02-01')).toEqual([]);
    expect(applied([fee])).toEqual([]);
  });
});
