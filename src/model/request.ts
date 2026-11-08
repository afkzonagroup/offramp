// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

import type { LocalDate } from '../time/zone.ts';
import type { ChargeKind } from './profile.ts';

/**
 * A switching request (Art. 25(3)) and what happened to it. The request is a plain JSON record; its state and
 * deadlines are always derived from it (see `computeTimeline`), never stored, so they cannot drift.
 */

export const REQUEST_FORMAT = 'offramp/switching-request';

/** Art. 25(3): what the customer decided to do at the end of the notice period. */
export type SwitchingTarget =
  | { readonly kind: 'provider'; readonly providerName: string; readonly details?: string }
  | { readonly kind: 'on-premises'; readonly details?: string }
  | { readonly kind: 'erase' };

export const TARGET_KINDS = ['provider', 'on-premises', 'erase'] as const;

export interface Customer {
  readonly name: string;
  /** Customer or contract number at the provider. */
  readonly reference?: string;
  readonly contactEmail?: string;
}

/** The data and digital assets the customer chose to port (by identifiers in the provider profile). */
export interface ChosenData {
  readonly categoryIds: readonly string[];
  readonly assetIds: readonly string[];
}

interface EventBase {
  /** When it happened (UTC ISO). */
  readonly at: string;
  readonly note?: string;
}

/** Art. 25(4): the provider notified that the 30-day transitional period is technically unfeasible. */
export interface UnfeasibilityNotified extends EventBase {
  readonly type: 'unfeasibility-notified';
  /** The justification given to the customer. */
  readonly reasons: string;
  /** Last day of the alternative transitional period (at most seven months). */
  readonly alternativeTransitionEnd: LocalDate;
}

/** Art. 25(5): the customer extended the transitional period (once). */
export interface CustomerExtension extends EventBase {
  readonly type: 'customer-extension';
  /** New last day of the transitional period. */
  readonly newTransitionEnd: LocalDate;
}

export interface TransitionStarted extends EventBase {
  readonly type: 'transition-started';
}

/** Art. 25(2)(c)(i): switching completed successfully; the contract is terminated and the customer notified. */
export interface SwitchingCompleted extends EventBase {
  readonly type: 'switching-completed';
}

/** Art. 25(2)(h): erasure of exportable data and digital assets confirmed. */
export interface ErasureConfirmed extends EventBase {
  readonly type: 'erasure-confirmed';
  /** What was erased, in words. */
  readonly scope?: string;
}

/** The customer withdrew the request. */
export interface Cancelled extends EventBase {
  readonly type: 'cancelled';
  readonly reason?: string;
}

export type RequestEvent = UnfeasibilityNotified | CustomerExtension | TransitionStarted | SwitchingCompleted | ErasureConfirmed | Cancelled;
export const EVENT_TYPES = ['unfeasibility-notified', 'customer-extension', 'transition-started', 'switching-completed', 'erasure-confirmed', 'cancelled'] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/** A charge actually imposed in this switching process. */
export interface AppliedCharge {
  readonly id: string;
  /** The item in the provider profile's charge schedule, if any. */
  readonly chargeId?: string;
  readonly kind: ChargeKind;
  readonly description?: string;
  /** Total amount in minor units of the profile currency. */
  readonly amountMinor: number;
  /** Costs directly linked to the switching process, as declared by the provider (Art. 29(3)). */
  readonly directlyLinkedCostMinor?: number;
  /** Calendar day on which the charge is imposed (invoiced). */
  readonly imposedOn: LocalDate;
  /** Additional services: requested by the customer (recital 89). */
  readonly customerRequested?: boolean;
  /** Additional services: price agreed in advance (recital 89). */
  readonly priceAgreedInAdvance?: boolean;
}

export interface SwitchingRequest {
  readonly format: typeof REQUEST_FORMAT;
  readonly version: 1;
  readonly id: string;
  /** Name of the source provider, as in the profile. */
  readonly provider: string;
  /** SHA-256 of the provider profile the request was created against (canonical JSON). */
  readonly profileDigest?: string;
  readonly customer: Customer;
  readonly serviceIds: readonly string[];
  readonly target: SwitchingTarget;
  readonly data: ChosenData;
  /** When the switching request was made (Art. 25(4): "the making of the switching request"). UTC ISO. */
  readonly receivedAt: string;
  /** Agreed first day of the transitional period, when it differs from the day after the notice period. */
  readonly transitionStartDate?: LocalDate;
  /** Agreed data retrieval period in calendar days, when longer than the contract's. */
  readonly retrievalDays?: number;
  /** Art. 25(2)(h): an agreed date, later than the end of the retrieval period, from which erasure takes place. */
  readonly erasureNotBefore?: LocalDate;
  readonly events: readonly RequestEvent[];
  readonly charges: readonly AppliedCharge[];
  readonly notes?: string;
}
