// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { CONTRACT_FLAGS, validateProfile } from '../src/model/parse-profile.ts';
import { checkProfile, TWO_MONTHS_IN_DAYS } from '../src/rules/contract.ts';
import { summarise, type Finding } from '../src/rules/findings.ts';
import { profile } from './helpers.ts';

const codes = (f: readonly Finding[]): string[] => f.map((x) => x.code);

function check(changes: Record<string, unknown> = {}): Finding[] {
  return [...checkProfile(profile(changes)).findings];
}

/** The smallest valid profile: everything optional left out. */
const MINIMAL = validateProfile({
  format: 'offramp/provider-profile',
  version: 1,
  provider: { name: 'Bare' },
  timeZone: 'UTC',
  services: [{ id: 's', name: 'S', deliveryModel: 'saas' }],
});

describe('contract-terms checker', () => {
  it('finds no conflicts or missing items in the complete example', () => {
    const r = checkProfile(profile());
    expect(r.counts.conflict).toBe(0);
    expect(r.counts.missing).toBe(0);
    expect(r.provider).toBe('Example Cloud');
  });

  it('lists every Art. 25 contract item as missing for a bare profile', () => {
    const r = checkProfile(MINIMAL);
    const c = codes(r.findings);
    // unfeasibilityClause is reported as a note: Art. 25(4) applies whether or not the contract repeats it.
    for (const flag of CONTRACT_FLAGS.filter((x) => x !== 'unfeasibilityClause')) expect(c, flag).toContain(`contract.${flag}`);
    expect(c).toContain('unfeasibility-procedure');
    for (const code of ['contract-not-described', 'notice-period-not-stated', 'transition-not-stated', 'retrieval-not-stated', 'procedures-missing', 'register-missing', 'jurisdictions-missing', 'jurisdiction-page-missing', 'measures-page-missing', 'data-categories-missing', 'digital-assets-not-stated', 'methods-missing', 'restrictions-not-stated', 'interfaces-missing']) {
      expect(c, code).toContain(code);
    }
    for (const flag of ['registerCoversDataStructures', 'registerCoversDataFormats', 'registerCoversStandards', 'registerCoversOpenInteroperabilitySpecifications', 'preContractStandardServiceFees', 'preContractEarlyTerminationPenalties']) {
      expect(c, flag).toContain(`information.${flag}`);
    }
    expect(r.counts.conflict).toBe(0);
  });

  it('cites an article for every finding', () => {
    for (const f of checkProfile(MINIMAL).findings) {
      expect(f.ref.cite).toMatch(/^(Art\. \d+|Recital \d+)/);
      expect(f.ref.url).toMatch(/^https:\/\/eur-lex\.europa\.eu\/legal-content\/EN\/TXT\/HTML\/\?uri=CELEX:32023R2854#(art|rct)_\d+$/);
    }
  });

  it('says when a clause is stated as absent', () => {
    const f = check({ 'contract.optionErase': false }).find((x) => x.code === 'contract.optionErase');
    expect(f?.message).toMatch(/^Stated as absent/);
  });

  it('sorts conflicts first', () => {
    const f = check({ 'contract.transitionDays': 31, 'contract.writtenContract': undefined });
    expect(f[0]?.severity).toBe('conflict');
  });

  describe('notice period (Art. 25(2)(d))', () => {
    it('knows how long two months can be', () => {
      expect(TWO_MONTHS_IN_DAYS).toEqual({ min: 59, max: 62 });
    });

    it.each([
      [{ unit: 'months', value: 2 }, null],
      [{ unit: 'months', value: 3 }, 'notice-period-too-long'],
      [{ unit: 'days', value: 59 }, null],
      [{ unit: 'days', value: 60 }, 'notice-period-may-exceed'],
      [{ unit: 'days', value: 62 }, 'notice-period-may-exceed'],
      [{ unit: 'days', value: 63 }, 'notice-period-too-long'],
      [{ unit: 'days', value: 0 }, null],
    ])('%j gives %s', (np, code) => {
      const c = codes(check({ 'contract.noticePeriod': np })).filter((x) => x.startsWith('notice-period'));
      expect(c).toEqual(code === null ? [] : [code]);
    });
  });

  it('checks the transitional period, retrieval period and Art. 25(4) values', () => {
    expect(codes(check({ 'contract.transitionDays': 30 }))).not.toContain('transition-too-long');
    expect(codes(check({ 'contract.transitionDays': 31 }))).toContain('transition-too-long');
    expect(codes(check({ 'contract.retrievalDays': 30 }))).not.toContain('retrieval-too-short');
    expect(codes(check({ 'contract.retrievalDays': 29 }))).toContain('retrieval-too-short');
    expect(codes(check({ 'contract.unfeasibilityNoticeWorkingDays': 15 }))).toContain('unfeasibility-notice-too-late');
    expect(codes(check({ 'contract.unfeasibilityNoticeWorkingDays': 14 }))).not.toContain('unfeasibility-notice-too-late');
    expect(codes(check({ 'contract.maxAlternativeTransitionMonths': 8 }))).toContain('alternative-period-too-long');
    expect(codes(check({ 'contract.unfeasibilityClause': undefined }))).toContain('unfeasibility-procedure');
  });

  it('checks data categories, formats and exemptions (Art. 25(2)(e), (f); Art. 30(5))', () => {
    expect(codes(check({ 'services.1.exportableData': [] }))).toContain('data-categories-missing');
    expect(codes(check({ 'services.1.exportableData.0.formats': [] }))).toContain('category-no-format');
    expect(codes(check({ 'services.1.exportableData.0.formats.0.machineReadable': false, 'services.1.exportableData.0.formats.1.machineReadable': false }))).toContain('category-not-machine-readable');
    const ex = check({ 'services.0.exemptedData.0.tradeSecretRisk': false });
    expect(ex.find((f) => f.code === 'exemption-without-trade-secret')?.severity).toBe('conflict');
  });

  it('checks functional equivalence and unbundling for IaaS (Art. 30(1), Art. 23(e))', () => {
    const f = check({ 'services.0.functionalEquivalence': { capabilities: true } });
    expect(f.filter((x) => x.code === 'functional-equivalence')).toHaveLength(3);
    expect(codes(f)).toContain('functional-equivalence-tools');
    expect(codes(check({ 'services.0.unbundling': undefined }))).toContain('unbundling-not-stated');
    // Custom-built IaaS: Art. 30(1) does not apply (Art. 31(1)).
    expect(codes(check({ 'services.0.functionalEquivalence': undefined, 'services.0.regime': 'custom-built', 'services.0.offeredAtBroadCommercialScale': false }))).not.toContain('functional-equivalence');
    // ...unless it is offered at broad commercial scale, which Art. 31(1) excludes: then Art. 30(1) is checked.
    expect(codes(check({ 'services.0.functionalEquivalence': undefined, 'services.0.regime': 'custom-built', 'services.0.offeredAtBroadCommercialScale': true }))).toEqual(expect.arrayContaining(['custom-built-at-scale', 'functional-equivalence']));
  });

  it('checks open interfaces for other services (Art. 30(2))', () => {
    expect(codes(check({ 'services.1.interfaces': [] }))).toContain('interfaces-missing');
    const f = check({ 'services.1.interfaces.0.freeOfCharge': false, 'services.1.interfaces.1.availableToDestinationProviders': undefined });
    expect(f.filter((x) => x.code === 'interface-condition').map((x) => x.severity).sort()).toEqual(['conflict', 'missing']);
  });

  it('checks the specific regimes of Art. 31', () => {
    expect(codes(check({ 'services.1.regime': 'custom-built', 'services.1.offeredAtBroadCommercialScale': true }))).toContain('custom-built-at-scale');
    expect(codes(check({ 'services.1.regime': 'custom-built' }))).toContain('custom-built-scale-not-stated');
    expect(codes(check({ 'services.1.regime': 'custom-built', 'services.1.offeredAtBroadCommercialScale': false }))).toContain('exemptions-not-informed');
    const np = check({ 'services.1.regime': 'non-production', 'services.1.interfaces': [] });
    expect(codes(np)).toContain('non-production');
    expect(codes(np)).toContain('non-production-period');
    expect(codes(np)).not.toContain('interfaces-missing');
    expect(codes(check({ 'services.1.regime': 'non-production', 'services.1.limitedPeriodDays': 90 }))).not.toContain('non-production-period');
  });

  it('skips the Chapter VI checks when every service is a non-production version (Art. 31(2))', () => {
    const onlyTest = { 'services.0.regime': 'non-production', 'services.0.limitedPeriodDays': 30, 'services.1.regime': 'non-production', 'services.1.limitedPeriodDays': 30, contract: undefined, 'information.exemptionsInformedBeforeContract': true, charges: { currency: 'EUR', items: [{ id: 'e', name: 'Egress', kind: 'data-egress', amountMinor: 9 }] } };
    const f = check(onlyTest);
    expect(codes(f)).toContain('chapter-vi-not-applicable');
    expect(f.filter((x) => x.severity === 'conflict' || x.severity === 'missing').map((x) => x.code)).toEqual([]);
    expect(codes(check({ ...onlyTest, 'information.exemptionsInformedBeforeContract': undefined }))).toEqual(expect.arrayContaining(['exemptions-not-informed']));
    // One standard service is enough for every check to run.
    expect(codes(check({ 'services.1.regime': 'non-production', 'services.1.limitedPeriodDays': 30, contract: undefined }))).toContain('contract-not-described');
  });

  it('checks charge information duties (Art. 29(4)-(6))', () => {
    expect(codes(check({ 'information.preContractReducedSwitchingCharges': undefined }))).toContain('information.preContractReducedSwitchingCharges');
    expect(codes(check({ 'information.preContractReducedSwitchingCharges': undefined, 'charges.items': [] }))).not.toContain('information.preContractReducedSwitchingCharges');
    expect(codes(check({ 'information.chargesInformationUrl': undefined }))).toContain('charges-info-not-public');
    expect(codes(check({ 'services.1.complexSwitchingInfo': 'Large archives take weeks.' }))).not.toContain('complex-switching');
    expect(codes(check({ 'charges.items': [{ id: 'x', name: 'Egress', kind: 'data-egress', amountMinor: 3 }] }))).toContain('charge-after-cutover');
  });

  it('notes free tiers and missing public holidays', () => {
    expect(codes(check())).toContain('free-tier');
    expect(codes(check({ workingDays: undefined }))).toContain('no-public-holidays');
  });
});

describe('summary wording', () => {
  it('never says compliant', () => {
    for (const r of [checkProfile(profile()), checkProfile(MINIMAL)]) {
      expect(r.summary).not.toMatch(/\bcompliant\b|\bcompliance\b/i);
      expect(r.summary).toMatch(/not a legal assessment/);
      for (const f of r.findings) expect(f.message).not.toMatch(/\bcompliant\b/i);
    }
    expect(summarise([])).toMatch(/^No gaps found in the information provided/);
    expect(summarise([])).toMatch(/does not mean/);
  });
});
