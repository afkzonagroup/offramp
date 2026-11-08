// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

import { computeTimeline, contractLastDay, type Timeline } from '../engine/timeline.ts';
import { LAW, REF, type ArticleRef } from '../legal/refs.ts';
import type { ChargeItem, ContractTerms, DataFormat, DeliveryModel, ProviderProfile, Regime, ServiceProfile } from '../model/profile.ts';
import type { RequestEvent, SwitchingRequest } from '../model/request.ts';
import { checkAppliedCharges, LAST_REDUCED_CHARGE_DAY } from '../rules/charges.ts';
import type { Finding } from '../rules/findings.ts';
import { formatLocal, toIso } from '../time/zone.ts';
import { OfframpError } from '../util/errors.ts';
import type { Block, DocKind, DocSection, OfframpDocument } from './model.ts';

export interface DocOptions {
  /** The moment the document is generated for (default: now). */
  readonly now?: number;
}

const MODEL_LABEL: Record<DeliveryModel, string> = { iaas: 'Infrastructure as a Service (IaaS)', paas: 'Platform as a Service (PaaS)', saas: 'Software as a Service (SaaS)', other: 'Other delivery model' };
const REGIME_LABEL: Record<Regime, string> = {
  standard: 'All of Chapter VI applies',
  'custom-built': 'Custom-built (Art. 31(1)): Art. 23(d), Art. 29 and Art. 30(1) and (3) do not apply',
  'non-production': 'Non-production version for testing and evaluation (Art. 31(2)): Chapter VI does not apply',
};

function section(heading: string, refs: readonly ArticleRef[], blocks: readonly (Block | undefined | false)[]): DocSection {
  return { heading, refs, blocks: blocks.filter((b): b is Block => b !== undefined && b !== false) };
}

function stated(v: boolean | undefined): string {
  return v === true ? 'Yes' : v === false ? 'No' : 'Not stated';
}

function clause(c: ContractTerms | undefined, key: keyof ContractTerms): string {
  const ref = c?.clauseRefs?.[key];
  return ref === undefined ? '' : ` (clause ${ref})`;
}

function formatList(formats: readonly DataFormat[]): string {
  if (formats.length === 0) return 'Not stated';
  return formats.map((f) => (f.mediaType === undefined ? f.name : `${f.name} (${f.mediaType})`)).join('; ');
}

function money(minor: number, currency: string): string {
  return `${(minor / 100).toFixed(2)} ${currency}`;
}

function chargeKindLabel(kind: ChargeItem['kind']): string {
  switch (kind) {
    case 'switching':
      return 'Switching charge';
    case 'data-egress':
      return 'Data egress charge (switching)';
    case 'standard-service-fee':
      return 'Standard service fee';
    case 'early-termination-penalty':
      return 'Early termination penalty';
    case 'additional-service':
      return 'Additional service at your request';
    case 'parallel-use-egress':
      return 'Egress charge for in-parallel use';
  }
}

function headerFacts(profile: ProviderProfile): Block {
  const p = profile.provider;
  const rows: [string, string][] = [['Provider', p.name]];
  if (p.legalName !== undefined) rows.push(['Legal name', p.legalName]);
  if (p.website !== undefined) rows.push(['Website', p.website]);
  if (p.contactEmail !== undefined) rows.push(['Contact', p.contactEmail]);
  if (p.switchingContact !== undefined) rows.push(['Switching contact', p.switchingContact]);
  return { kind: 'facts', rows };
}

function servicesById(profile: ProviderProfile, ids: readonly string[]): ServiceProfile[] {
  return ids.map((id) => profile.services.find((s) => s.id === id)).filter((s): s is ServiceProfile => s !== undefined);
}

// ---------------------------------------------------------------------------------------------------------------
// Information pack (Art. 25, 26, 28, 29, 30, 31)

/**
 * The information a provider gives customers about switching: contract terms of Art. 25, the information of
 * Art. 26, charges under Art. 29, technical aspects under Art. 30, specific regimes under Art. 31(3) and the
 * transparency information of Art. 28. Only what the profile states is shown; gaps say "Not stated".
 */
export function informationPack(profile: ProviderProfile, opts: DocOptions = {}): OfframpDocument {
  const c = profile.contract;
  const info = profile.information;
  const sections: DocSection[] = [];
  sections.push(
    section('About this information', [REF.obstacles], [
      headerFacts(profile),
      { kind: 'paragraph', text: 'This document describes how customers can switch from the services below to another provider of data processing services or to their own (on-premises) ICT infrastructure, as provided for in Chapter VI of Regulation (EU) 2023/2854 (Data Act).' },
    ]),
  );
  sections.push(
    section('Services covered', [REF.dataProcessingService, REF.sameServiceType, REF.recitalTypes], [
      {
        kind: 'table',
        head: ['Service', 'Delivery model', 'Service type', 'Rules that apply'],
        rows: profile.services.map((s) => [s.name, MODEL_LABEL[s.deliveryModel], s.serviceType ?? 'Not stated', REGIME_LABEL[s.regime]]),
      },
    ]),
  );
  const np = c?.noticePeriod;
  sections.push(
    section('How to switch', [REF.customerOptions, REF.informationProcedures], [
      { kind: 'paragraph', text: info?.switchingProcedures ?? 'Switching procedures: not stated.' },
      { kind: 'paragraph', text: 'When the notice period ends, you can tell us that you want to:' },
      {
        kind: 'list',
        items: [
          `switch to a different provider; please give us the details of that provider${clause(c, 'optionSwitchToProvider')}`,
          `switch to your on-premises ICT infrastructure${clause(c, 'optionSwitchToOnPremises')}`,
          `erase your exportable data and digital assets${clause(c, 'optionErase')}`,
        ],
      },
      profile.provider.switchingContact !== undefined && { kind: 'paragraph', text: `Send switching requests to: ${profile.provider.switchingContact}` },
    ]),
  );
  sections.push(
    section('Periods', [REF.noticePeriod, REF.switchClause, REF.unfeasibility, REF.customerExtension, REF.retrieval, REF.erasure], [
      {
        kind: 'table',
        head: ['Period', 'In our contract', 'Rule in the Regulation'],
        rows: [
          ['Notice period before switching starts', np === undefined ? 'Not stated' : `${np.value} ${np.unit}${clause(c, 'noticePeriod')}`, 'At most two months (Art. 25(2)(d))'],
          ['Transitional period (switching is done)', c?.transitionDays === undefined ? 'Not stated' : `${c.transitionDays} calendar days${clause(c, 'transitionDays')}`, `At most ${LAW.maxTransitionDays} calendar days, starting after the notice period; the contract stays in force (Art. 25(2)(a))`],
          ['If 30 days are technically unfeasible', c?.unfeasibilityClause === true ? `Described in the contract${clause(c, 'unfeasibilityClause')}` : 'Not described in the contract', `We notify you within ${LAW.unfeasibilityNoticeWorkingDays} working days of your request, explain why, and propose an alternative period of at most ${LAW.maxAlternativeTransitionMonths} months; the service continues (Art. 25(4))`],
          ['Your extension', c?.customerExtensionRight === true ? `Yes${clause(c, 'customerExtensionRight')}` : stated(c?.customerExtensionRight), 'You may extend the transitional period once, for a period you consider appropriate (Art. 25(5))'],
          ['Data retrieval period', c?.retrievalDays === undefined ? 'Not stated' : `${c.retrievalDays} calendar days${clause(c, 'retrievalDays')}`, `At least ${LAW.minRetrievalDays} calendar days after the transitional period (Art. 25(2)(g))`],
          ['Erasure', c?.erasureGuaranteed === true ? `Guaranteed${clause(c, 'erasureGuaranteed')}` : stated(c?.erasureGuaranteed), 'Full erasure after the retrieval period, or a later agreed date, once switching is completed (Art. 25(2)(h))'],
        ],
      },
      {
        kind: 'paragraph',
        text: 'The contract ends when switching is completed successfully, or, if you choose erasure instead of switching, at the end of the notice period. We notify you of the termination (Art. 25(2)(c)).',
      },
    ]),
  );
  sections.push(
    section('What we do during the transitional period', [REF.switchClause, REF.exitStrategy, REF.goodFaith], [
      {
        kind: 'table',
        head: ['Commitment', 'In our contract'],
        rows: [
          ['Reasonable assistance to you and third parties you authorise (Art. 25(2)(a)(i))', stated(c?.reasonableAssistance)],
          ['Due care for business continuity; the services continue (Art. 25(2)(a)(ii))', stated(c?.businessContinuity)],
          ['Clear information on known risks to continuity (Art. 25(2)(a)(iii))', stated(c?.knownRisksInformation)],
          ['High level of security, including data in transfer and during retrieval (Art. 25(2)(a)(iv))', stated(c?.highLevelOfSecurity)],
          ['Support for your exit strategy, with all relevant information (Art. 25(2)(b))', stated(c?.exitStrategySupport)],
        ],
      },
    ]),
  );
  for (const s of profile.services.filter((x) => x.regime !== 'non-production')) {
    sections.push(
      section(`Data and digital assets you can take: ${s.name}`, [REF.dataCategories, REF.exportableData, REF.digitalAssets], [
        (s.exportableData ?? []).length === 0
          ? { kind: 'paragraph', text: 'Exportable data categories: not stated.' }
          : { kind: 'table', head: ['Data category', 'Kind', 'Formats'], rows: (s.exportableData ?? []).map((d) => [d.description === undefined ? d.name : `${d.name}: ${d.description}`, d.origin ?? 'Not stated', formatList(d.formats)]) },
        s.digitalAssets === undefined
          ? { kind: 'paragraph', text: 'Digital assets: not stated.' }
          : s.digitalAssets.length === 0
            ? { kind: 'paragraph', text: 'Digital assets: none.' }
            : { kind: 'table', head: ['Digital asset', 'Kind', 'Formats'], rows: s.digitalAssets.map((a) => [a.description === undefined ? a.name : `${a.name}: ${a.description}`, a.kind, formatList(a.formats)]) },
        (s.exemptedData ?? []).length > 0 && { kind: 'paragraph', text: 'Data specific to the internal functioning of the service that is not exported, because exporting it would risk a breach of our trade secrets (Art. 25(2)(f)):' },
        (s.exemptedData ?? []).length > 0 && { kind: 'table', head: ['Category', 'Reason'], rows: (s.exemptedData ?? []).map((e) => [e.name, e.reason]) },
      ]),
    );
    const ifs = s.interfaces ?? [];
    sections.push(
      section(`Methods, interfaces and limitations: ${s.name}`, s.deliveryModel === 'iaas' ? [REF.informationProcedures, REF.functionalEquivalenceDuty] : [REF.informationProcedures, REF.openInterfaces], [
        (s.switchingMethods ?? []).length === 0 ? { kind: 'paragraph', text: 'Switching and porting methods: not stated.' } : { kind: 'list', items: s.switchingMethods ?? [] },
        ifs.length > 0 && {
          kind: 'table',
          head: ['Interface', 'Kind', 'Free of charge', 'Documentation'],
          rows: ifs.map((i) => [i.name, i.kind, stated(i.freeOfCharge), i.documentationUrl ?? 'Not stated']),
        },
        s.knownRestrictions === undefined
          ? { kind: 'paragraph', text: 'Known restrictions and technical limitations: not stated.' }
          : { kind: 'paragraph', text: s.knownRestrictions.length === 0 ? 'Known restrictions and technical limitations: none known.' : 'Known restrictions and technical limitations:' },
        (s.knownRestrictions ?? []).length > 0 && { kind: 'list', items: s.knownRestrictions ?? [] },
        (s.standards ?? []).length > 0 && { kind: 'paragraph', text: `Standards and open interoperability specifications: ${(s.standards ?? []).join('; ')}` },
        s.estimatedSwitchingTime !== undefined && { kind: 'paragraph', text: `Estimated time to complete switching: ${s.estimatedSwitchingTime}` },
        s.deliveryModel === 'iaas' && s.regime === 'standard' && {
          kind: 'paragraph',
          text: `To help you reach functional equivalence with a service of the same type, we provide: capabilities: ${stated(s.functionalEquivalence?.capabilities)}; information: ${stated(s.functionalEquivalence?.information)}; documentation: ${stated(s.functionalEquivalence?.documentation)}; technical support: ${stated(s.functionalEquivalence?.technicalSupport)}${(s.functionalEquivalence?.tools ?? []).length > 0 ? `; tools: ${(s.functionalEquivalence?.tools ?? []).join(', ')}` : ''}.`,
        },
        s.complexSwitchingInfo !== undefined && { kind: 'note', text: `Highly complex or costly switching (Art. 29(5)): ${s.complexSwitchingInfo}` },
      ]),
    );
  }
  sections.push(
    section('Online register of data structures and formats', [REF.informationRegister], [
      info?.onlineRegisterUrl === undefined ? { kind: 'paragraph', text: 'Address of the online register: not stated.' } : { kind: 'link', label: 'Online register of data structures, data formats, standards and open interoperability specifications', url: info.onlineRegisterUrl },
    ]),
  );
  const items = profile.charges?.items ?? [];
  const cur = profile.charges?.currency ?? '';
  sections.push(
    section('Charges', [REF.switchingCharges, REF.noCharges, REF.reducedCharges, REF.chargesCostCap, REF.chargesPreContract], [
      {
        kind: 'paragraph',
        text: `Until ${LAST_REDUCED_CHARGE_DAY}, providers may charge reduced switching charges that do not exceed the costs directly linked to the switching process. From ${LAW.noSwitchingChargesFrom}, no switching charges, including data egress charges, may be imposed. Standard service fees and early termination penalties are not switching charges.`,
      },
      items.length === 0
        ? { kind: 'paragraph', text: 'Charges: not stated.' }
        : {
            kind: 'table',
            head: ['Charge', 'Kind', 'Price', 'Applies'],
            rows: items.map((i) => [
              i.name,
              chargeKindLabel(i.kind),
              `${money(i.amountMinor, cur)}${i.unit === undefined ? '' : ` ${i.unit}`}`,
              i.appliesFrom === undefined && i.appliesUntil === undefined ? 'Always' : `${i.appliesFrom ?? '…'} to ${i.appliesUntil ?? '…'}`,
            ]),
          },
      info?.chargesInformationUrl !== undefined && { kind: 'link', label: 'Public information on charges', url: info.chargesInformationUrl },
    ]),
  );
  const special = profile.services.filter((s) => s.regime !== 'standard');
  if (special.length > 0) {
    sections.push(
      section('Obligations that do not apply', [REF.customBuilt, REF.nonProduction, REF.exemptionsInformed], [{ kind: 'table', head: ['Service', 'What does not apply'], rows: special.map((s) => [s.name, REGIME_LABEL[s.regime]]) }]),
    );
  }
  const ia = profile.internationalAccess;
  sections.push(
    section('Jurisdiction and international access', [REF.internationalAccess, REF.internationalAccessInContract], [
      { kind: 'paragraph', text: `Jurisdiction of the ICT infrastructure: ${(ia?.jurisdictions ?? []).length === 0 ? 'not stated' : (ia?.jurisdictions ?? []).join('; ')}.` },
      ia?.jurisdictionInformationUrl !== undefined && { kind: 'link', label: 'Jurisdiction information', url: ia.jurisdictionInformationUrl },
      ia?.measuresInformationUrl !== undefined && { kind: 'link', label: 'Measures against unlawful international governmental access', url: ia.measuresInformationUrl },
    ]),
  );
  return { kind: 'information-pack', title: `Switching information: ${profile.provider.name}`, subtitle: 'Information for customers under Articles 25, 26, 28, 29, 30 and 31 of Regulation (EU) 2023/2854', language: 'en', generatedAt: toIso(opts.now ?? Date.now()), sections };
}

// ---------------------------------------------------------------------------------------------------------------
// Request documents

function targetText(req: SwitchingRequest): string {
  switch (req.target.kind) {
    case 'provider':
      return `Switch to ${req.target.providerName}`;
    case 'on-premises':
      return 'Switch to on-premises ICT infrastructure';
    case 'erase':
      return 'Erase exportable data and digital assets (no switching)';
  }
}

function requestFacts(profile: ProviderProfile, req: SwitchingRequest): Block {
  const rows: [string, string][] = [
    ['Request', req.id],
    ['Customer', req.customer.name],
  ];
  if (req.customer.reference !== undefined) rows.push(['Customer reference', req.customer.reference]);
  rows.push(['Provider', profile.provider.name], ['Services', servicesById(profile, req.serviceIds).map((s) => s.name).join(', ')], ['Decision', targetText(req)]);
  if (req.target.kind !== 'erase' && req.target.details !== undefined) rows.push(['Destination details', req.target.details]);
  rows.push(['Request made', formatLocal(req.receivedAt, profile.timeZone)]);
  return { kind: 'facts', rows };
}

function chosenData(profile: ProviderProfile, req: SwitchingRequest): Block[] {
  const services = servicesById(profile, req.serviceIds);
  const cats = services.flatMap((s) => s.exportableData ?? []).filter((c) => req.data.categoryIds.includes(c.id));
  const assets = services.flatMap((s) => s.digitalAssets ?? []).filter((a) => req.data.assetIds.includes(a.id));
  const rows = [...cats.map((c) => [c.name, 'Data', formatList(c.formats)]), ...assets.map((a) => [a.name, `Digital asset (${a.kind})`, formatList(a.formats)])];
  return rows.length === 0 ? [{ kind: 'paragraph', text: 'No data categories or digital assets are selected.' }] : [{ kind: 'table', head: ['Item', 'Type', 'Formats'], rows }];
}

function keyDates(t: Timeline): Block {
  const rows: [string, string][] = [[`Notice period ends`, t.notice.lastDay]];
  if (t.unfeasibilityNoticeDue !== undefined) rows.push(['We tell you if 30 days are technically unfeasible by', t.unfeasibilityNoticeDue]);
  if (t.transition !== undefined) rows.push(['Transitional period', `${t.transition.firstDay} to ${t.transition.lastDay}`]);
  if (t.retrieval !== undefined) rows.push(['Data retrieval period', `${t.retrieval.firstDay} to ${t.retrieval.lastDay}`]);
  rows.push(['Erasure from', t.erasureFrom]);
  return { kind: 'facts', rows };
}

function milestonesTable(t: Timeline): Block {
  return { kind: 'table', head: ['Milestone', 'Date', 'Status', 'How it is worked out', 'Article'], rows: t.milestones.map((m) => [m.label, m.date, m.status, m.basis, m.ref.cite]) };
}

function findingsBlock(findings: readonly Finding[]): Block {
  return findings.length === 0 ? { kind: 'paragraph', text: 'None.' } : { kind: 'table', head: ['Severity', 'Point', 'Article'], rows: findings.map((f) => [f.severity, f.subject === undefined ? f.message : `${f.subject}: ${f.message}`, f.ref.cite]) };
}

const DUTIES: Block = {
  kind: 'list',
  items: [
    'Provide reasonable assistance to the customer and third parties the customer authorises (Art. 25(2)(a)(i)).',
    'Act with due care to maintain business continuity and continue providing the services under the contract (Art. 25(2)(a)(ii)).',
    'Give clear information on known risks to continuity (Art. 25(2)(a)(iii)).',
    'Maintain a high level of security, in particular for data in transfer and during the retrieval period (Art. 25(2)(a)(iv)).',
  ],
};

/** A plan for one switching request: timeline with every statutory date, data, duties, charges and points to check. */
export function switchingPlan(profile: ProviderProfile, req: SwitchingRequest, opts: DocOptions = {}): OfframpDocument {
  const now = opts.now ?? Date.now();
  const t = computeTimeline(profile, req, { now });
  const chargeFindings = checkAppliedCharges(profile, req, contractLastDay(t));
  const cur = profile.charges?.currency ?? '';
  const sections: DocSection[] = [
    section('Request', [REF.customerOptions], [requestFacts(profile, req), { kind: 'paragraph', text: `Current state: ${t.state}.` }]),
    section('Timeline', [REF.noticePeriod, REF.switchClause, REF.unfeasibility, REF.customerExtension, REF.retrieval, REF.erasure], [keyDates(t), milestonesTable(t)]),
  ];
  if (req.target.kind !== 'erase') {
    sections.push(section('Data and digital assets to port', [REF.dataCategories, REF.machineReadableExport], chosenData(profile, req)));
    sections.push(section('Provider duties during the transitional period', [REF.switchClause, REF.goodFaith], [DUTIES, { kind: 'paragraph', text: 'All parties, including the destination provider, cooperate in good faith (Art. 27).' }]));
    sections.push(
      section("Customer's rights", [REF.customerExtension, REF.recitalExtension], [
        { kind: 'paragraph', text: 'The customer may extend the transitional period once, for a period the customer considers appropriate, before or during the transitional period. The contract remains applicable during the transitional period.' },
      ]),
    );
  }
  sections.push(
    section('Charges in this switching process', [REF.noCharges, REF.reducedCharges, REF.chargesCostCap], [
      req.charges.length === 0
        ? { kind: 'paragraph', text: 'No charges are recorded.' }
        : { kind: 'table', head: ['Charge', 'Kind', 'Amount', 'Imposed on'], rows: req.charges.map((c) => [c.description ?? c.id, chargeKindLabel(c.kind), money(c.amountMinor, cur), c.imposedOn]) },
    ]),
  );
  sections.push(section('Points to check', [], [findingsBlock([...t.findings, ...chargeFindings].filter((f) => f.severity !== 'info'))]));
  sections.push(section('Assumptions', [REF.definitions], [{ kind: 'list', items: t.assumptions }]));
  return { kind: 'switching-plan', title: `Switching plan: ${req.id}`, subtitle: `${req.customer.name} — ${targetText(req)}`, language: 'en', generatedAt: toIso(now), sections };
}

/** Acknowledgement of receipt of the switching request, with the dates that follow from it. */
export function receiptNotice(profile: ProviderProfile, req: SwitchingRequest, opts: DocOptions = {}): OfframpDocument {
  const now = opts.now ?? Date.now();
  const t = computeTimeline(profile, req, { now });
  const erase = req.target.kind === 'erase';
  const sections: DocSection[] = [
    section('Your request', [REF.customerOptions], [
      { kind: 'paragraph', text: `We received your switching request on ${formatLocal(req.receivedAt, profile.timeZone)}.` },
      requestFacts(profile, req),
    ]),
    section('What happens next', erase ? [REF.noticePeriod, REF.terminationOnErase, REF.erasure] : [REF.noticePeriod, REF.switchClause, REF.unfeasibility, REF.retrieval, REF.erasure], [
      keyDates(t),
      erase
        ? { kind: 'paragraph', text: `As you chose erasure, the contract ends at the end of the notice period (${t.notice.lastDay}) and we will notify you of the termination. Your exportable data and digital assets are then erased.` }
        : {
            kind: 'paragraph',
            text: `Switching takes place in the transitional period, during which your contract and our services continue. If completing it within ${LAW.maxTransitionDays} calendar days is technically unfeasible, we will tell you by ${t.unfeasibilityNoticeDue ?? ''}, explain why, and propose an alternative period of at most seven months.`,
          },
    ]),
  ];
  if (!erase) {
    sections.push(section('Your data', [REF.dataCategories], chosenData(profile, req)));
    sections.push(section('What we do during switching', [REF.switchClause], [DUTIES]));
    sections.push(section('Your right to extend', [REF.customerExtension], [{ kind: 'paragraph', text: 'You may extend the transitional period once, for a period you consider more appropriate. Tell us before the transitional period ends.' }]));
  }
  if (profile.provider.switchingContact !== undefined) sections.push(section('Contact', [], [{ kind: 'paragraph', text: profile.provider.switchingContact }]));
  return { kind: 'receipt-notice', title: 'Switching request received', subtitle: `${profile.provider.name} — request ${req.id}`, language: 'en', generatedAt: toIso(now), sections };
}

function requireEvent<T extends RequestEvent['type']>(req: SwitchingRequest, type: T, what: string): Extract<RequestEvent, { type: T }> {
  const e = req.events.find((x): x is Extract<RequestEvent, { type: T }> => x.type === type);
  if (e === undefined) throw new OfframpError('CONFLICT', `Record "${type}" on the request before generating the ${what}.`);
  return e;
}

/** Art. 25(4) notification that the 30-day transitional period is technically unfeasible, with reasons and the alternative period. */
export function unfeasibilityNotice(profile: ProviderProfile, req: SwitchingRequest, opts: DocOptions = {}): OfframpDocument {
  const e = requireEvent(req, 'unfeasibility-notified', 'unfeasibility notice');
  const now = opts.now ?? Date.now();
  const t = computeTimeline(profile, req, { now });
  const late = t.findings.find((f) => f.code === 'unfeasibility-notified-late');
  return {
    kind: 'unfeasibility-notice',
    title: 'Alternative transitional period: technical unfeasibility',
    subtitle: `${profile.provider.name} — request ${req.id}`,
    language: 'en',
    generatedAt: toIso(now),
    sections: [
      section('Notification', [REF.unfeasibility], [
        requestFacts(profile, req),
        { kind: 'paragraph', text: `Completing your switching within the transitional period of ${LAW.maxTransitionDays} calendar days is technically unfeasible. This notification is made on ${formatLocal(e.at, profile.timeZone)}; the last day for it was ${t.unfeasibilityNoticeDue ?? ''}.` },
        late !== undefined && { kind: 'note', text: late.message },
      ]),
      section('Reasons', [REF.unfeasibility, REF.recitalExtension], [{ kind: 'paragraph', text: e.reasons }]),
      section('Alternative transitional period', [REF.unfeasibility], [
        {
          kind: 'facts',
          rows: [
            ['Standard transitional period would have ended', t.transition?.standardLastDay ?? ''],
            ['Alternative transitional period', `${t.transition?.firstDay ?? ''} to ${e.alternativeTransitionEnd}`],
            ['Latest end allowed (seven months)', t.transition?.alternativeCapLastDay ?? ''],
          ],
        },
        { kind: 'paragraph', text: 'Our services continue throughout the alternative transitional period, and the contract remains applicable.' },
        { kind: 'paragraph', text: 'You keep the right to extend the transitional period once, for a period you consider more appropriate (Art. 25(5)).' },
      ]),
    ],
  };
}

/** Confirms the customer's extension of the transitional period (Art. 25(5)). */
export function extensionConfirmation(profile: ProviderProfile, req: SwitchingRequest, opts: DocOptions = {}): OfframpDocument {
  const e = requireEvent(req, 'customer-extension', 'extension confirmation');
  const now = opts.now ?? Date.now();
  const t = computeTimeline(profile, req, { now });
  return {
    kind: 'extension-confirmation',
    title: 'Extension of the transitional period confirmed',
    subtitle: `${profile.provider.name} — request ${req.id}`,
    language: 'en',
    generatedAt: toIso(now),
    sections: [
      section('Extension', [REF.customerExtension], [
        requestFacts(profile, req),
        { kind: 'paragraph', text: `On ${formatLocal(e.at, profile.timeZone)} you extended the transitional period. It now ends on ${t.transition?.lastDay ?? e.newTransitionEnd}. The contract and our services continue until switching is completed.` },
        keyDates(t),
      ]),
    ],
  };
}

/** Art. 25(2)(c)(i): switching completed; the contract is terminated; retrieval and erasure dates. */
export function completionNotice(profile: ProviderProfile, req: SwitchingRequest, opts: DocOptions = {}): OfframpDocument {
  const e = requireEvent(req, 'switching-completed', 'completion notice');
  const now = opts.now ?? Date.now();
  const t = computeTimeline(profile, req, { now });
  return {
    kind: 'completion-notice',
    title: 'Switching completed: contract terminated',
    subtitle: `${profile.provider.name} — request ${req.id}`,
    language: 'en',
    generatedAt: toIso(now),
    sections: [
      section('Completion', [REF.terminationOnSwitch], [
        requestFacts(profile, req),
        { kind: 'paragraph', text: `The switching process was completed successfully on ${formatLocal(e.at, profile.timeZone)}. In accordance with the contract, the contract is terminated and we hereby notify you of the termination.` },
      ]),
      section('Retrieval and erasure', [REF.retrieval, REF.erasure], [
        { kind: 'facts', rows: [['Data retrieval period', t.retrieval === undefined ? '' : `${t.retrieval.firstDay} to ${t.retrieval.lastDay}`], ['Erasure from', t.erasureFrom]] },
        { kind: 'paragraph', text: 'You can retrieve your data during the retrieval period. Afterwards, all exportable data and digital assets generated directly by you or relating to you directly are fully erased. Security of the data is maintained during the retrieval period.' },
      ]),
    ],
  };
}

/** Art. 25(2)(h): confirmation of full erasure of exportable data and digital assets. */
export function erasureConfirmation(profile: ProviderProfile, req: SwitchingRequest, opts: DocOptions = {}): OfframpDocument {
  const e = requireEvent(req, 'erasure-confirmed', 'erasure confirmation');
  const now = opts.now ?? Date.now();
  const t = computeTimeline(profile, req, { now });
  const early = t.findings.find((f) => f.code === 'erased-before-retrieval-end');
  return {
    kind: 'erasure-confirmation',
    title: 'Erasure confirmed',
    subtitle: `${profile.provider.name} — request ${req.id}`,
    language: 'en',
    generatedAt: toIso(now),
    sections: [
      section('Erasure', [REF.erasure], [
        requestFacts(profile, req),
        { kind: 'paragraph', text: `On ${formatLocal(e.at, profile.timeZone)} we fully erased all exportable data and digital assets generated directly by you or relating to you directly, for the services named above.` },
        e.scope !== undefined && { kind: 'paragraph', text: `Scope: ${e.scope}` },
        early !== undefined && { kind: 'note', text: early.message },
      ]),
    ],
  };
}

/** Generates any document kind. Request documents need `req`. */
export function generateDocument(kind: DocKind, profile: ProviderProfile, req: SwitchingRequest | undefined, opts: DocOptions = {}): OfframpDocument {
  if (kind === 'information-pack') return informationPack(profile, opts);
  if (req === undefined) throw new OfframpError('USAGE', `The ${kind} needs a switching request.`);
  switch (kind) {
    case 'switching-plan':
      return switchingPlan(profile, req, opts);
    case 'receipt-notice':
      return receiptNotice(profile, req, opts);
    case 'unfeasibility-notice':
      return unfeasibilityNotice(profile, req, opts);
    case 'extension-confirmation':
      return extensionConfirmation(profile, req, opts);
    case 'completion-notice':
      return completionNotice(profile, req, opts);
    case 'erasure-confirmation':
      return erasureConfirmation(profile, req, opts);
  }
}
