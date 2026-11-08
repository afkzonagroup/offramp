// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Legal references and statutory values of Chapter VI of Regulation (EU) 2023/2854 (Data Act),
 * OJ L, 2023/2854, 22.12.2023. Every value here is taken from the official English text on EUR-Lex.
 * Interpretation choices are documented in LEGAL.md and next to the code that applies them.
 */

/** Official text (English, HTML) on EUR-Lex. */
export const EUR_LEX_URL = 'https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32023R2854';
/** European Legislation Identifier of the Regulation. */
export const ELI_URL = 'http://data.europa.eu/eli/reg/2023/2854/oj';

/** A provision of the Regulation, e.g. Art. 25(2)(d). */
export interface ArticleRef {
  /** Short citation, e.g. "Art. 25(2)(d)". */
  readonly cite: string;
  /** Link to the article in the official text. */
  readonly url: string;
}

/** Builds a reference to an article; `rest` is the paragraph and point, e.g. "(2)(d)". */
export function art(article: number, rest = ''): ArticleRef {
  return { cite: `Art. ${article}${rest}`, url: `${EUR_LEX_URL}#art_${article}` };
}

/** Builds a reference to a recital. Recitals explain the articles; they are not binding on their own. */
export function recital(n: number): ArticleRef {
  return { cite: `Recital ${n}`, url: `${EUR_LEX_URL}#rct_${n}` };
}

/**
 * Statutory values. Each one names the provision it comes from.
 * Periods are maximums or minimums as the text states; a contract may be more favourable to the customer.
 */
export const LAW = {
  /** Art. 25(2)(d): maximum notice period for initiation of the switching process: "shall not exceed two months". */
  maxNoticeMonths: 2,
  /** Art. 25(2)(a): "mandatory maximum transitional period of 30 calendar days". */
  maxTransitionDays: 30,
  /** Art. 25(4): the provider notifies technical unfeasibility "within 14 working days of the making of the switching request". */
  unfeasibilityNoticeWorkingDays: 14,
  /** Art. 25(4): the alternative transitional period "shall not exceed seven months". */
  maxAlternativeTransitionMonths: 7,
  /** Art. 25(2)(g): "a minimum period for data retrieval of at least 30 calendar days". */
  minRetrievalDays: 30,
  /** Art. 50, second paragraph: "It shall apply from 12 September 2025." */
  applicationDate: '2025-09-12',
  /** Art. 29(2): reduced switching charges "From 11 January 2024 to 12 January 2027". */
  reducedChargesFrom: '2024-01-11',
  /** Art. 29(1): "From 12 January 2027, providers ... shall not impose any switching charges". */
  noSwitchingChargesFrom: '2027-01-12',
} as const;

/** Citations used across the library, so every finding and document line links to the same place. */
export const REF = {
  definitions: art(2),
  dataProcessingService: art(2, ', point (8)'),
  sameServiceType: art(2, ', point (9)'),
  customer: art(2, ', point (30)'),
  digitalAssets: art(2, ', point (32)'),
  onPremises: art(2, ', point (33)'),
  switching: art(2, ', point (34)'),
  egressCharges: art(2, ', point (35)'),
  switchingCharges: art(2, ', point (36)'),
  functionalEquivalence: art(2, ', point (37)'),
  exportableData: art(2, ', point (38)'),
  obstacles: art(23),
  obstaclesFreeTier: art(23, ', point (c)'),
  obstaclesUnbundling: art(23, ', point (e)'),
  scope: art(24),
  writtenContract: art(25, '(1)'),
  switchClause: art(25, '(2)(a)'),
  assistance: art(25, '(2)(a)(i)'),
  continuity: art(25, '(2)(a)(ii)'),
  knownRisks: art(25, '(2)(a)(iii)'),
  security: art(25, '(2)(a)(iv)'),
  exitStrategy: art(25, '(2)(b)'),
  termination: art(25, '(2)(c)'),
  terminationOnSwitch: art(25, '(2)(c)(i)'),
  terminationOnErase: art(25, '(2)(c)(ii)'),
  noticePeriod: art(25, '(2)(d)'),
  dataCategories: art(25, '(2)(e)'),
  exemptedCategories: art(25, '(2)(f)'),
  retrieval: art(25, '(2)(g)'),
  erasure: art(25, '(2)(h)'),
  chargesClause: art(25, '(2)(i)'),
  customerOptions: art(25, '(3)'),
  unfeasibility: art(25, '(4)'),
  customerExtension: art(25, '(5)'),
  informationProcedures: art(26, ', point (a)'),
  informationRegister: art(26, ', point (b)'),
  goodFaith: art(27),
  internationalAccess: art(28, '(1)'),
  internationalAccessInContract: art(28, '(2)'),
  noCharges: art(29, '(1)'),
  reducedCharges: art(29, '(2)'),
  chargesCostCap: art(29, '(3)'),
  chargesPreContract: art(29, '(4)'),
  complexSwitching: art(29, '(5)'),
  chargesPublic: art(29, '(6)'),
  functionalEquivalenceDuty: art(30, '(1)'),
  openInterfaces: art(30, '(2)'),
  commonSpecifications: art(30, '(3)'),
  registerUpdate: art(30, '(4)'),
  machineReadableExport: art(30, '(5)'),
  noNewTechnology: art(30, '(6)'),
  customBuilt: art(31, '(1)'),
  nonProduction: art(31, '(2)'),
  exemptionsInformed: art(31, '(3)'),
  parallelUse: art(34, '(1)'),
  parallelEgress: art(34, '(2)'),
  application: art(50),
  recitalTypes: recital(81),
  recitalAssets: recital(83),
  recitalSwitchingSteps: recital(85),
  recitalFunctionalEquivalence: recital(86),
  recitalExtension: recital(87),
  recitalCharges: recital(88),
  recitalAdditionalServices: recital(89),
  recitalInformation: recital(95),
  recitalCustomBuilt: recital(98),
  recitalParallel: recital(99),
} as const satisfies Record<string, ArticleRef>;
