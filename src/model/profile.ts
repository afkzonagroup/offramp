// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

import type { LocalDate } from '../time/zone.ts';

/**
 * Provider profile: what a provider of data processing services states about its services, its contract
 * terms on switching, its information duties and its charges. Most fields are optional so that a partial
 * profile can be checked; the contract-terms checker lists what is missing.
 */

export const PROFILE_FORMAT = 'offramp/provider-profile';

/** Service delivery models named in recital 81 (IaaS, PaaS, SaaS), plus "other" for emerging variations. */
export const DELIVERY_MODELS = ['iaas', 'paas', 'saas', 'other'] as const;
export type DeliveryModel = (typeof DELIVERY_MODELS)[number];

/**
 * - standard: all of Chapter VI applies.
 * - custom-built: Art. 31(1) (majority of main features custom-built for one customer, not offered at broad commercial scale).
 * - non-production: Art. 31(2) (non-production version for testing and evaluation, for a limited period).
 */
export const REGIMES = ['standard', 'custom-built', 'non-production'] as const;
export type Regime = (typeof REGIMES)[number];

/** Kinds of digital assets; recital 83 names applications, configuration metadata, access rights, virtual machines and containers. */
export const ASSET_KINDS = ['application', 'configuration', 'access-rights', 'virtual-machine', 'container', 'other'] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

/** Origin of exportable data under Art. 2, point (38): input data, output data, metadata, or a mix. */
export const DATA_ORIGINS = ['input', 'output', 'metadata', 'mixed'] as const;
export type DataOrigin = (typeof DATA_ORIGINS)[number];

export const INTERFACE_KINDS = ['api', 'bulk-export', 'console', 'other'] as const;
export type InterfaceKind = (typeof INTERFACE_KINDS)[number];

/**
 * - switching: a switching charge (Art. 2, point (36)) other than data egress.
 * - data-egress: data egress charge for switching (Art. 2, point (35)); a switching charge.
 * - standard-service-fee: fee for the service itself; not a switching charge (Art. 2, point (36); recital 89).
 * - early-termination-penalty: not a switching charge (Art. 2, point (36)); disclosed before contract (Art. 29(4)).
 * - additional-service: work beyond the provider's switching obligations at the customer's request (recital 89).
 * - parallel-use-egress: egress charge for in-parallel use (Art. 34(2)).
 */
export const CHARGE_KINDS = ['switching', 'data-egress', 'standard-service-fee', 'early-termination-penalty', 'additional-service', 'parallel-use-egress'] as const;
export type ChargeKind = (typeof CHARGE_KINDS)[number];

/** Charge kinds that are switching charges within Art. 2, point (36). */
export const SWITCHING_CHARGE_KINDS: readonly ChargeKind[] = ['switching', 'data-egress'];

export const UNBUNDLING = ['feasible', 'not-feasible', 'not-applicable'] as const;
export type Unbundling = (typeof UNBUNDLING)[number];

export interface DataFormat {
  /** E.g. "CSV (RFC 4180)", "Parquet", "OCI image". */
  readonly name: string;
  /** IANA media type, e.g. "text/csv". */
  readonly mediaType?: string;
  /** Link to the format's specification. */
  readonly specificationUrl?: string;
  readonly structured?: boolean;
  readonly commonlyUsed?: boolean;
  readonly machineReadable?: boolean;
  /** The specification is an open interoperability specification or a standard. */
  readonly openSpecification?: boolean;
}

/** A category of exportable data (Art. 25(2)(e); Art. 2, point (38)). */
export interface DataCategory {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly origin?: DataOrigin;
  readonly formats: readonly DataFormat[];
}

/** A digital asset the customer can port (Art. 2, point (32); Art. 25(2)(e)). */
export interface DigitalAsset {
  readonly id: string;
  readonly name: string;
  readonly kind: AssetKind;
  readonly description?: string;
  readonly formats: readonly DataFormat[];
}

/** Data specific to the internal functioning of the service, exempted from export (Art. 25(2)(f)). */
export interface ExemptedCategory {
  readonly id: string;
  readonly name: string;
  /** Why exporting it would risk a breach of the provider's trade secrets. */
  readonly reason: string;
  /** The provider states that a risk of breach of trade secrets exists (the only ground Art. 25(2)(f) allows). */
  readonly tradeSecretRisk: boolean;
}

/** An interface for switching and porting (Art. 26(a); Art. 30(2)). */
export interface SwitchingInterface {
  readonly name: string;
  readonly kind: InterfaceKind;
  readonly documentationUrl?: string;
  readonly freeOfCharge?: boolean;
  readonly availableToAllCustomers?: boolean;
  readonly availableToDestinationProviders?: boolean;
}

/** Support for functional equivalence by infrastructure services (Art. 30(1)). */
export interface FunctionalEquivalenceSupport {
  readonly capabilities?: boolean;
  readonly information?: boolean;
  readonly documentation?: boolean;
  readonly technicalSupport?: boolean;
  /** Tools offered, where appropriate. */
  readonly tools?: readonly string[];
}

export interface ServiceProfile {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly deliveryModel: DeliveryModel;
  /** Description of the same service type (Art. 2, point (9)): primary objective, model, main functionalities. */
  readonly serviceType?: string;
  readonly regime: Regime;
  /** Art. 31(1): the service is offered at broad commercial scale via the service catalogue. */
  readonly offeredAtBroadCommercialScale?: boolean;
  /** Art. 31(2): length of the limited period of a non-production version, in days. */
  readonly limitedPeriodDays?: number;
  readonly exportableData?: readonly DataCategory[];
  readonly digitalAssets?: readonly DigitalAsset[];
  readonly exemptedData?: readonly ExemptedCategory[];
  readonly interfaces?: readonly SwitchingInterface[];
  /** Available switching and porting methods (Art. 26(a)). */
  readonly switchingMethods?: readonly string[];
  /** Known restrictions and technical limitations (Art. 26(a)). */
  readonly knownRestrictions?: readonly string[];
  /** Relevant standards and open interoperability specifications (Art. 26(b); Art. 30(3)). */
  readonly standards?: readonly string[];
  readonly functionalEquivalence?: FunctionalEquivalenceSupport;
  /** Art. 23(e): unbundling of infrastructure services from other services. */
  readonly unbundling?: Unbundling;
  readonly unbundlingNote?: string;
  /** The service has a free tier (Art. 23(c)). */
  readonly freeTier?: boolean;
  /** Estimated time to complete switching (recital 95). */
  readonly estimatedSwitchingTime?: string;
  /** Art. 29(5): information on highly complex or costly switching, or switching impossible without significant interference. */
  readonly complexSwitchingInfo?: string;
}

/** A period expressed in days or months. */
export interface Duration {
  readonly unit: 'days' | 'months';
  readonly value: number;
}

/** What the contract says, as structured facts. Each flag states that the contract contains the clause. */
export interface ContractTerms {
  /** Art. 25(1): rights and obligations on switching are set out in a written contract. */
  readonly writtenContract?: boolean;
  /** Art. 25(1): made available before signing, in a way that allows storing and reproducing it. */
  readonly availableBeforeSigning?: boolean;
  readonly storableAndReproducible?: boolean;
  /** Art. 25(2)(a): clause allowing the customer to switch or port to on-premises on request. */
  readonly switchingClause?: boolean;
  /** Art. 25(2)(a): the transitional period agreed, in calendar days (at most 30). */
  readonly transitionDays?: number;
  /** Art. 25(2)(a)(i)–(iv): duties during the transitional period. */
  readonly reasonableAssistance?: boolean;
  readonly businessContinuity?: boolean;
  readonly knownRisksInformation?: boolean;
  readonly highLevelOfSecurity?: boolean;
  /** Art. 25(2)(b). */
  readonly exitStrategySupport?: boolean;
  /** Art. 25(2)(c)(i) and (ii), and notification of the termination. */
  readonly terminationOnSuccessfulSwitch?: boolean;
  readonly terminationOnEraseAtNoticeEnd?: boolean;
  readonly terminationNotified?: boolean;
  /** Art. 25(2)(d): the maximum notice period (at most two months). */
  readonly noticePeriod?: Duration;
  /** Art. 25(2)(g): the data retrieval period in calendar days (at least 30). */
  readonly retrievalDays?: number;
  /** Art. 25(2)(h): full erasure is guaranteed after the retrieval period (or a later agreed period). */
  readonly erasureGuaranteed?: boolean;
  /** Art. 25(2)(i): the contract states the switching charges, in accordance with Art. 29. */
  readonly chargesClause?: boolean;
  /** Art. 25(3)(a)–(c): the customer may notify each option. */
  readonly optionSwitchToProvider?: boolean;
  readonly optionSwitchToOnPremises?: boolean;
  readonly optionErase?: boolean;
  /** Art. 25(4): technical unfeasibility procedure as written in the contract. */
  readonly unfeasibilityClause?: boolean;
  readonly unfeasibilityNoticeWorkingDays?: number;
  readonly maxAlternativeTransitionMonths?: number;
  /** Art. 25(5): customer right to extend the transitional period once. */
  readonly customerExtensionRight?: boolean;
  /** Art. 28(2): the Art. 28(1) websites are listed in the contract. */
  readonly internationalAccessWebsitesListed?: boolean;
  /** Clause numbers, e.g. { "noticePeriod": "12.3" }, so documents can cite them. */
  readonly clauseRefs?: Readonly<Record<string, string>>;
}

export interface InformationDuties {
  /** Art. 26(a): description of available switching and porting procedures. */
  readonly switchingProcedures?: string;
  /** Art. 26(b): the online register of data structures and formats. */
  readonly onlineRegisterUrl?: string;
  readonly registerCoversDataStructures?: boolean;
  readonly registerCoversDataFormats?: boolean;
  readonly registerCoversStandards?: boolean;
  readonly registerCoversOpenInteroperabilitySpecifications?: boolean;
  /** Art. 29(4): before contract, clear information on standard fees, early termination penalties and reduced switching charges. */
  readonly preContractStandardServiceFees?: boolean;
  readonly preContractEarlyTerminationPenalties?: boolean;
  readonly preContractReducedSwitchingCharges?: boolean;
  /** Art. 29(6): where the Art. 29(4) and (5) information is publicly available. */
  readonly chargesInformationUrl?: string;
  /** Art. 31(3): prospective customers are informed of the obligations that do not apply. */
  readonly exemptionsInformedBeforeContract?: boolean;
}

/** Art. 28(1): information on the provider's website. */
export interface InternationalAccess {
  /** Jurisdictions to which the ICT infrastructure of the services is subject. */
  readonly jurisdictions?: readonly string[];
  readonly jurisdictionInformationUrl?: string;
  readonly measuresInformationUrl?: string;
}

export interface ChargeItem {
  readonly id: string;
  readonly name: string;
  readonly kind: ChargeKind;
  /** Price in minor units of the currency (e.g. cents). 0 means free. */
  readonly amountMinor: number;
  /** What the price is per, e.g. "GB transferred". */
  readonly unit?: string;
  /** Costs directly linked to the switching process, in the same unit, as declared by the provider (Art. 29(3)). */
  readonly directlyLinkedCostMinor?: number;
  /** How the directly linked cost was established. Offramp does not assess it. */
  readonly costBasis?: string;
  /** First and last calendar day on which the item may be charged. */
  readonly appliesFrom?: LocalDate;
  readonly appliesUntil?: LocalDate;
  /** Services the item applies to; all services when absent. */
  readonly serviceIds?: readonly string[];
  /** Additional services: only performed at the customer's request (recital 89). */
  readonly onlyOnCustomerRequest?: boolean;
  /** Additional services: price agreed with the customer in advance (recital 89). */
  readonly priceAgreedInAdvance?: boolean;
}

export interface ChargeSchedule {
  /** ISO 4217 currency code. */
  readonly currency: string;
  readonly items: readonly ChargeItem[];
}

export interface ProviderInfo {
  readonly name: string;
  readonly legalName?: string;
  readonly website?: string;
  readonly contactEmail?: string;
  /** Who customers contact about switching. */
  readonly switchingContact?: string;
}

export interface WorkingDays {
  /**
   * Public holidays that are not working days, as calendar dates. Saturdays and Sundays are never working days.
   * The Data Act does not say whose holidays count; see LEGAL.md.
   */
  readonly publicHolidays: readonly LocalDate[];
  /** Which calendar the holidays come from, e.g. "Lithuania". */
  readonly calendarName?: string;
}

export interface ProviderProfile {
  readonly $schema?: string;
  readonly format: typeof PROFILE_FORMAT;
  readonly version: 1;
  readonly provider: ProviderInfo;
  /** IANA time zone in which calendar days are counted, e.g. "Europe/Vilnius". */
  readonly timeZone: string;
  readonly workingDays?: WorkingDays;
  readonly services: readonly ServiceProfile[];
  readonly contract?: ContractTerms;
  readonly information?: InformationDuties;
  readonly internationalAccess?: InternationalAccess;
  readonly charges?: ChargeSchedule;
}
