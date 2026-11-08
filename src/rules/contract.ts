// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

import { LAW, REF, type ArticleRef } from '../legal/refs.ts';
import type { ContractTerms, DataFormat, InformationDuties, ProviderProfile, ServiceProfile } from '../model/profile.ts';
import { addDays, addMonthsClamped, daysBetween } from '../time/zone.ts';
import { checkChargeSchedule, effectiveRegime, isSwitchingCharge } from './charges.ts';
import { countBySeverity, finding, sortFindings, summarise, type Finding, type Severity } from './findings.ts';

export interface ProfileReport {
  readonly provider: string;
  readonly findings: readonly Finding[];
  readonly counts: Record<Severity, number>;
  /** Never says "compliant"; see `summarise`. */
  readonly summary: string;
}

/**
 * Shortest and longest number of days that "two months" can span, over four years that include a leap year
 * (month lengths repeat, so this covers every case).
 * A notice period in days up to the shortest never exceeds two months; above the longest it always does.
 */
export const TWO_MONTHS_IN_DAYS = ((): { min: number; max: number } => {
  let min = Infinity;
  let max = 0;
  for (let d = '2024-01-01'; d < '2028-01-01'; d = addDays(d, 1)) {
    const n = daysBetween(d, addMonthsClamped(d, LAW.maxNoticeMonths));
    min = Math.min(min, n);
    max = Math.max(max, n);
  }
  return { min, max };
})();

type Flag<T> = readonly [key: keyof T, ref: ArticleRef, what: string];

const CONTRACT_REQUIRED: readonly Flag<ContractTerms>[] = [
  ['writtenContract', REF.writtenContract, 'Switching rights and obligations are set out in a written contract'],
  ['availableBeforeSigning', REF.writtenContract, 'The contract is made available before signing'],
  ['storableAndReproducible', REF.writtenContract, 'The contract is provided in a way the customer can store and reproduce'],
  ['switchingClause', REF.switchClause, 'Clause allowing the customer to switch, or to port all exportable data and digital assets to on-premises ICT infrastructure, on request'],
  ['reasonableAssistance', REF.assistance, 'Reasonable assistance to the customer and authorised third parties during switching'],
  ['businessContinuity', REF.continuity, 'Due care for business continuity and continued provision of the services during switching'],
  ['knownRisksInformation', REF.knownRisks, 'Clear information on known risks to continuity'],
  ['highLevelOfSecurity', REF.security, 'High level of security during switching, including data in transfer and during the retrieval period'],
  ['exitStrategySupport', REF.exitStrategy, "Support for the customer's exit strategy, including all relevant information"],
  ['terminationOnSuccessfulSwitch', REF.terminationOnSwitch, 'Contract terminated upon successful completion of switching'],
  ['terminationOnEraseAtNoticeEnd', REF.terminationOnErase, 'Contract terminated at the end of the notice period when the customer chooses erasure'],
  ['terminationNotified', REF.termination, 'Customer notified of the termination'],
  ['erasureGuaranteed', REF.erasure, 'Full erasure of exportable data and digital assets after the retrieval period'],
  ['chargesClause', REF.chargesClause, 'Switching charges stated in accordance with Art. 29'],
  ['optionSwitchToProvider', REF.customerOptions, 'Customer may notify a switch to a different provider (Art. 25(3)(a))'],
  ['optionSwitchToOnPremises', REF.customerOptions, 'Customer may notify a switch to on-premises ICT infrastructure (Art. 25(3)(b))'],
  ['optionErase', REF.customerOptions, 'Customer may notify erasure of its exportable data and digital assets (Art. 25(3)(c))'],
  ['customerExtensionRight', REF.customerExtension, 'Customer right to extend the transitional period once'],
  ['internationalAccessWebsitesListed', REF.internationalAccessInContract, 'The websites with the Art. 28(1) information are listed in the contract'],
];

const INFO_REQUIRED: readonly Flag<InformationDuties>[] = [
  ['registerCoversDataStructures', REF.informationRegister, 'The online register details all data structures'],
  ['registerCoversDataFormats', REF.informationRegister, 'The online register details all data formats'],
  ['registerCoversStandards', REF.informationRegister, 'The online register names the relevant standards'],
  ['registerCoversOpenInteroperabilitySpecifications', REF.informationRegister, 'The online register names the relevant open interoperability specifications'],
  ['preContractStandardServiceFees', REF.chargesPreContract, 'Clear information on standard service fees before the contract'],
  ['preContractEarlyTerminationPenalties', REF.chargesPreContract, 'Clear information on early termination penalties before the contract'],
];

function flags<T extends object>(source: T | undefined, list: readonly Flag<T>[], code: string, out: Finding[]): void {
  for (const [key, ref, what] of list) {
    const v = source?.[key];
    if (v === true) continue;
    out.push(finding(`${code}.${String(key)}`, 'missing', ref, v === false ? `Stated as absent: ${what}.` : `Not stated: ${what}.`));
  }
}

function checkContract(c: ContractTerms | undefined, out: Finding[]): void {
  if (c === undefined) out.push(finding('contract-not-described', 'missing', REF.writtenContract, 'The profile has no contract section; every Art. 25 item below is reported as not stated.'));
  flags(c, CONTRACT_REQUIRED, 'contract', out);

  // Art. 25(2)(d): notice period at most two months.
  const np = c?.noticePeriod;
  if (np === undefined) out.push(finding('notice-period-not-stated', 'missing', REF.noticePeriod, 'Not stated: the maximum notice period for initiation of the switching process (at most two months).'));
  else if (np.unit === 'months' && np.value > LAW.maxNoticeMonths) out.push(finding('notice-period-too-long', 'conflict', REF.noticePeriod, `The notice period of ${np.value} months exceeds two months.`));
  else if (np.unit === 'days' && np.value > TWO_MONTHS_IN_DAYS.max) out.push(finding('notice-period-too-long', 'conflict', REF.noticePeriod, `The notice period of ${np.value} days always exceeds two months (at most ${TWO_MONTHS_IN_DAYS.max} days).`));
  else if (np.unit === 'days' && np.value > TWO_MONTHS_IN_DAYS.min) {
    out.push(finding('notice-period-may-exceed', 'review', REF.noticePeriod, `A notice period of ${np.value} days exceeds two months for requests made on some days of the year (two months can be as short as ${TWO_MONTHS_IN_DAYS.min} days). Consider "2 months" or at most ${TWO_MONTHS_IN_DAYS.min} days.`));
  }

  // Art. 25(2)(a): transitional period at most 30 calendar days.
  if (c?.transitionDays === undefined) out.push(finding('transition-not-stated', 'missing', REF.switchClause, `Not stated: the transitional period (at most ${LAW.maxTransitionDays} calendar days).`));
  else if (c.transitionDays > LAW.maxTransitionDays) out.push(finding('transition-too-long', 'conflict', REF.switchClause, `The transitional period of ${c.transitionDays} days exceeds the maximum of ${LAW.maxTransitionDays} calendar days.`));

  // Art. 25(2)(g): retrieval at least 30 calendar days.
  if (c?.retrievalDays === undefined) out.push(finding('retrieval-not-stated', 'missing', REF.retrieval, `Not stated: the data retrieval period (at least ${LAW.minRetrievalDays} calendar days after the transitional period).`));
  else if (c.retrievalDays < LAW.minRetrievalDays) out.push(finding('retrieval-too-short', 'conflict', REF.retrieval, `The data retrieval period of ${c.retrievalDays} days is shorter than ${LAW.minRetrievalDays} calendar days.`));

  // Art. 25(4): the statutory procedure applies whether or not the contract repeats it; contradictions are flagged.
  if (c?.unfeasibilityNoticeWorkingDays !== undefined && c.unfeasibilityNoticeWorkingDays > LAW.unfeasibilityNoticeWorkingDays) {
    out.push(finding('unfeasibility-notice-too-late', 'conflict', REF.unfeasibility, `The contract allows ${c.unfeasibilityNoticeWorkingDays} working days to notify technical unfeasibility; Art. 25(4) requires notification within ${LAW.unfeasibilityNoticeWorkingDays}.`));
  }
  if (c?.maxAlternativeTransitionMonths !== undefined && c.maxAlternativeTransitionMonths > LAW.maxAlternativeTransitionMonths) {
    out.push(finding('alternative-period-too-long', 'conflict', REF.unfeasibility, `The contract allows an alternative transitional period of ${c.maxAlternativeTransitionMonths} months; Art. 25(4) caps it at ${LAW.maxAlternativeTransitionMonths}.`));
  }
  if (c?.unfeasibilityClause !== true) {
    out.push(finding('unfeasibility-procedure', 'info', REF.unfeasibility, 'The contract does not describe the technical unfeasibility procedure. Art. 25(4) applies anyway: notify within 14 working days of the request, justify, and propose an alternative period of at most seven months.'));
  }
}

function hasMachineReadable(formats: readonly DataFormat[]): boolean {
  return formats.some((f) => f.structured === true && f.commonlyUsed === true && f.machineReadable === true);
}

function checkService(s: ServiceProfile, out: Finding[]): void {
  const sub = `service ${s.id}`;
  if (s.regime === 'non-production') {
    out.push(finding('non-production', 'info', REF.nonProduction, `"${s.name}" is a non-production version for testing and evaluation: Chapter VI does not apply to it (Art. 31(2)). Other checks for this service are skipped.`, sub));
    if (s.limitedPeriodDays === undefined) out.push(finding('non-production-period', 'review', REF.nonProduction, 'Art. 31(2) covers non-production versions provided for a limited period of time. State the period.', sub));
    return;
  }
  const custom = effectiveRegime(s) === 'custom-built';
  if (s.regime === 'custom-built') {
    if (s.offeredAtBroadCommercialScale === true) out.push(finding('custom-built-at-scale', 'conflict', REF.customBuilt, 'The custom-built regime does not cover services offered at broad commercial scale via the service catalogue (Art. 31(1)).', sub));
    else if (s.offeredAtBroadCommercialScale === undefined) out.push(finding('custom-built-scale-not-stated', 'review', REF.customBuilt, 'State whether the service is offered at broad commercial scale via the service catalogue; if it is, Art. 31(1) does not apply.', sub));
  }
  if (s.serviceType === undefined) out.push(finding('service-type-not-described', 'info', REF.sameServiceType, 'Describe the service type (primary objective, service model, main functionalities) so customers can identify services of the same service type.', sub));

  // Art. 25(2)(e): exhaustive specification of data categories and digital assets.
  const cats = s.exportableData;
  if (cats === undefined || cats.length === 0) out.push(finding('data-categories-missing', 'missing', REF.dataCategories, 'No exportable data categories are specified. The contract must specify all categories of data that can be ported, at a minimum all exportable data.', sub));
  if (s.digitalAssets === undefined) out.push(finding('digital-assets-not-stated', 'missing', REF.dataCategories, 'Digital assets that can be ported are not specified (use an empty list if there are none).', sub));
  for (const c of cats ?? []) {
    if (c.formats.length === 0) out.push(finding('category-no-format', 'missing', REF.informationRegister, `No data format is given for "${c.name}".`, `${sub} / ${c.id}`));
    else if (!hasMachineReadable(c.formats)) {
      out.push(finding('category-not-machine-readable', 'review', REF.machineReadableExport, `No format of "${c.name}" is marked as structured, commonly used and machine-readable. Where no common specifications or harmonised standards are published, Art. 30(5) requires export in such a format.`, `${sub} / ${c.id}`));
    }
  }
  // Art. 25(2)(f): exemptions only where a risk of breach of trade secrets exists.
  for (const e of s.exemptedData ?? []) {
    if (!e.tradeSecretRisk) out.push(finding('exemption-without-trade-secret', 'conflict', REF.exemptedCategories, `"${e.name}" is exempted from export without a stated risk of breach of trade secrets, the only ground Art. 25(2)(f) allows.`, `${sub} / ${e.id}`));
    else out.push(finding('exemption-must-not-impede', 'info', REF.exemptedCategories, `"${e.name}" is exempted from export. Exemptions must not impede or delay switching.`, `${sub} / ${e.id}`));
  }

  // Art. 26(a): procedures, methods, formats, restrictions and limitations.
  if (s.switchingMethods === undefined || s.switchingMethods.length === 0) out.push(finding('methods-missing', 'missing', REF.informationProcedures, 'No switching and porting methods are listed.', sub));
  if (s.knownRestrictions === undefined) out.push(finding('restrictions-not-stated', 'missing', REF.informationProcedures, 'Known restrictions and technical limitations are not stated (use an empty list if there are none).', sub));

  if (s.deliveryModel === 'iaas') {
    // Art. 30(1): functional equivalence (not for custom-built services, Art. 31(1)).
    if (!custom) {
      const fe = s.functionalEquivalence;
      const items: [boolean | undefined, string][] = [
        [fe?.capabilities, 'capabilities'],
        [fe?.information, 'adequate information'],
        [fe?.documentation, 'documentation'],
        [fe?.technicalSupport, 'technical support'],
      ];
      for (const [v, what] of items) if (v !== true) out.push(finding('functional-equivalence', 'missing', REF.functionalEquivalenceDuty, `Not stated: ${what} to facilitate functional equivalence after switching.`, sub));
      if ((fe?.tools ?? []).length === 0) out.push(finding('functional-equivalence-tools', 'info', REF.functionalEquivalenceDuty, 'No tools are listed. Art. 30(1) requires the necessary tools "where appropriate".', sub));
    }
    // Art. 23(e): unbundling where technically feasible.
    if (s.unbundling === undefined) out.push(finding('unbundling-not-stated', 'review', REF.obstaclesUnbundling, 'State whether the service can be unbundled from other services, where technically feasible.', sub));
  } else {
    // Art. 30(2): open interfaces, free of charge, to an equal extent to all customers and destination providers.
    const ifs = s.interfaces ?? [];
    if (ifs.length === 0) out.push(finding('interfaces-missing', 'missing', REF.openInterfaces, 'No open interfaces are listed. Art. 30(2) requires open interfaces, free of charge, for customers and destination providers.', sub));
    for (const i of ifs) {
      const checks: [boolean | undefined, string][] = [
        [i.freeOfCharge, 'free of charge'],
        [i.availableToAllCustomers, 'available to all customers to an equal extent'],
        [i.availableToDestinationProviders, 'available to the destination providers concerned'],
      ];
      for (const [v, what] of checks) {
        if (v === false) out.push(finding('interface-condition', 'conflict', REF.openInterfaces, `Interface "${i.name}" is stated as not ${what}.`, sub));
        else if (v === undefined) out.push(finding('interface-condition', 'missing', REF.openInterfaces, `Not stated whether interface "${i.name}" is ${what}.`, sub));
      }
    }
  }
  if (s.freeTier === true) out.push(finding('free-tier', 'info', REF.obstaclesFreeTier, 'Customers of the free tier can port their exportable data and digital assets too (Art. 23(c)).', sub));
}

function checkInformation(profile: ProviderProfile, out: Finding[]): void {
  const info = profile.information;
  if (info?.switchingProcedures === undefined) out.push(finding('procedures-missing', 'missing', REF.informationProcedures, 'Not stated: information on available switching and porting procedures.'));
  if (info?.onlineRegisterUrl === undefined) out.push(finding('register-missing', 'missing', REF.informationRegister, 'Not stated: the address of the up-to-date online register of data structures, formats, standards and open interoperability specifications.'));
  flags(info, INFO_REQUIRED, 'information', out);
  const standard = profile.services.filter((s) => effectiveRegime(s) === 'standard');
  const charged = (profile.charges?.items ?? []).some((i) => isSwitchingCharge(i.kind) && i.amountMinor > 0 && (i.appliesFrom ?? '0000-01-01') < LAW.noSwitchingChargesFrom);
  if (charged && info?.preContractReducedSwitchingCharges !== true) {
    out.push(finding('information.preContractReducedSwitchingCharges', 'missing', REF.chargesPreContract, 'Switching charges are listed, but clear pre-contract information on the reduced switching charges is not stated.'));
  }
  if (info?.chargesInformationUrl === undefined) out.push(finding('charges-info-not-public', 'review', REF.chargesPublic, 'Where applicable, the Art. 29(4) and (5) information must be publicly available, e.g. on a dedicated web page. No address is stated.'));
  if (standard.length > 0 && standard.every((s) => s.complexSwitchingInfo === undefined)) {
    out.push(finding('complex-switching', 'info', REF.complexSwitching, 'Where relevant, inform customers of services with highly complex or costly switching, or where switching is impossible without significant interference (Art. 29(5)). None is stated.'));
  }
  if (profile.services.some((s) => s.regime !== 'standard') && info?.exemptionsInformedBeforeContract !== true) {
    out.push(finding('exemptions-not-informed', 'missing', REF.exemptionsInformed, 'Some services use a specific regime (Art. 31). Not stated: prospective customers are told before the contract which Chapter VI obligations do not apply.'));
  }
  if (standard.some((s) => s.deliveryModel !== 'iaas')) {
    out.push(finding('common-specifications', 'info', REF.commonSpecifications, 'Compatibility with common specifications or harmonised standards becomes due 12 months after their references are published in the central Union standards repository (Art. 30(3)); keep the online register updated (Art. 30(4)). Offramp does not track those publications.'));
  }
  const ia = profile.internationalAccess;
  if (ia?.jurisdictions === undefined || ia.jurisdictions.length === 0) out.push(finding('jurisdictions-missing', 'missing', REF.internationalAccess, 'Not stated: the jurisdiction to which the ICT infrastructure of each service is subject (to be published on the website).'));
  if (ia?.jurisdictionInformationUrl === undefined) out.push(finding('jurisdiction-page-missing', 'missing', REF.internationalAccess, 'Not stated: the web page with the jurisdiction information.'));
  if (ia?.measuresInformationUrl === undefined) out.push(finding('measures-page-missing', 'missing', REF.internationalAccess, 'Not stated: the web page describing measures against unlawful international governmental access to non-personal data.'));
  if ((profile.workingDays?.publicHolidays ?? []).length === 0) {
    out.push(finding('no-public-holidays', 'info', REF.unfeasibility, 'No public holidays are listed, so working days are Monday to Friday only. This gives the earliest date for the 14-working-day notification.'));
  }
}

/**
 * Reviews a provider profile against Chapter VI and lists what is missing, contradictory or needs review.
 * It never concludes that a provider is compliant: it can only see what the profile states.
 *
 * @example
 * const report = checkProfile(profile);
 * report.summary; // "2 conflict(s), 5 missing item(s), 1 item(s) to review. This is not a legal assessment."
 */
export function checkProfile(profile: ProviderProfile): ProfileReport {
  const out: Finding[] = [];
  if (profile.services.every((s) => s.regime === 'non-production')) {
    // Art. 31(2): Chapter VI does not apply to non-production versions; only Art. 31(3) (telling prospective
    // customers which obligations do not apply) and the conditions of Art. 31(2) itself are left to check.
    out.push(finding('chapter-vi-not-applicable', 'info', REF.nonProduction, 'Every service is a non-production version for testing and evaluation, so the obligations of Chapter VI do not apply (Art. 31(2)). Contract, information and charge checks are skipped.'));
    for (const s of profile.services) checkService(s, out);
    if (profile.information?.exemptionsInformedBeforeContract !== true) {
      out.push(finding('exemptions-not-informed', 'missing', REF.exemptionsInformed, 'Not stated: prospective customers are told before the contract which Chapter VI obligations do not apply (Art. 31(3)).'));
    }
  } else {
    checkContract(profile.contract, out);
    for (const s of profile.services) checkService(s, out);
    checkInformation(profile, out);
    out.push(...checkChargeSchedule(profile));
  }
  const findings = sortFindings(out);
  return { provider: profile.provider.name, findings, counts: countBySeverity(findings), summary: summarise(findings) };
}
