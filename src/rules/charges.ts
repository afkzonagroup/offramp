// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

import { LAW, REF } from '../legal/refs.ts';
import { SWITCHING_CHARGE_KINDS, type ChargeKind, type ProviderProfile, type ServiceProfile } from '../model/profile.ts';
import type { SwitchingRequest } from '../model/request.ts';
import { addDays, type LocalDate } from '../time/zone.ts';
import { finding, type Finding } from './findings.ts';

/**
 * Switching charge rules. Offramp flags; it never decides whether a cost is "directly linked" to switching
 * (Art. 29(3)) — that depends on the provider's cost accounting and is for the provider to evidence.
 *
 * Phases of Art. 29 by calendar day:
 * - before-application: before 12 September 2025, the date from which the Regulation applies (Art. 50).
 *   Art. 29(2) names 11 January 2024, but the Regulation as a whole applies only from 12 September 2025.
 * - reduced: 12 September 2025 up to and including 11 January 2027 — reduced switching charges allowed, not
 *   exceeding the costs directly linked to the switching process (Art. 29(2) and (3)).
 * - free: from 12 January 2027 — no switching charges (Art. 29(1)). Art. 29(2) says "to 12 January 2027"
 *   and Art. 29(1) "From 12 January 2027"; Offramp resolves the overlap on that day for the prohibition.
 */
export type ChargePhase = 'before-application' | 'reduced' | 'free';

export function chargePhase(day: LocalDate): ChargePhase {
  if (day >= LAW.noSwitchingChargesFrom) return 'free';
  if (day >= LAW.applicationDate) return 'reduced';
  return 'before-application';
}

/** Last day on which reduced switching charges may be imposed: 11 January 2027. */
export const LAST_REDUCED_CHARGE_DAY: LocalDate = addDays(LAW.noSwitchingChargesFrom, -1);

export function isSwitchingCharge(kind: ChargeKind): boolean {
  return SWITCHING_CHARGE_KINDS.includes(kind);
}

function servicesOf(profile: ProviderProfile, ids: readonly string[] | undefined): readonly ServiceProfile[] {
  return ids === undefined ? profile.services : profile.services.filter((s) => ids.includes(s.id));
}

/**
 * The regime whose exemptions Offramp applies. A service stated as custom-built but also stated as offered at
 * broad commercial scale via the service catalogue does not meet Art. 31(1), so the full rules are applied to it
 * (and the contradiction is reported by the profile check).
 */
export function effectiveRegime(s: ServiceProfile): ServiceProfile['regime'] {
  return s.regime === 'custom-built' && s.offeredAtBroadCommercialScale === true ? 'standard' : s.regime;
}

/** True when Art. 29 does not apply to any of the services (all custom-built or non-production, Art. 31). */
function art29Excluded(services: readonly ServiceProfile[]): boolean {
  return services.length > 0 && services.every((s) => effectiveRegime(s) !== 'standard');
}

function money(minor: number, currency: string): string {
  return `${(minor / 100).toFixed(2)} ${currency}`;
}

interface CostInput {
  readonly amountMinor: number;
  readonly directlyLinkedCostMinor?: number | undefined;
  readonly costBasis?: string | undefined;
}

/** Shared cost-cap check for reduced switching charges (Art. 29(3)) and parallel-use egress (Art. 34(2)). */
function costCap(item: CostInput, subject: string, currency: string, parallel: boolean): Finding[] {
  const ref = parallel ? REF.parallelEgress : REF.chargesCostCap;
  const what = parallel ? 'egress costs incurred' : 'costs directly linked to the switching process';
  if (item.amountMinor === 0) return [];
  if (item.directlyLinkedCostMinor === undefined) {
    return [finding(parallel ? 'parallel-egress-cost-not-stated' : 'charge-cost-not-stated', 'review', ref, `No ${what} are stated for this charge. The charge must not exceed them; Offramp does not assess the cost basis.`, subject)];
  }
  if (item.amountMinor > item.directlyLinkedCostMinor) {
    return [finding(parallel ? 'parallel-egress-exceeds-cost' : 'charge-exceeds-cost', 'conflict', ref, `The charge (${money(item.amountMinor, currency)}) exceeds the stated ${what} (${money(item.directlyLinkedCostMinor, currency)}).`, subject)];
  }
  if (item.costBasis === undefined) {
    return [finding('charge-cost-basis-not-documented', 'review', ref, `The charge is within the stated ${what}. Document how those costs were established; Offramp does not verify them.`, subject)];
  }
  return [finding('charge-within-stated-cost', 'info', ref, `The charge is within the stated ${what}. Offramp does not verify the cost basis.`, subject)];
}

/**
 * Checks the charge schedule of a provider profile against Art. 29 and Art. 34(2) and recital 89.
 *
 * @example
 * checkChargeSchedule(profile).filter((f) => f.severity === 'conflict');
 */
export function checkChargeSchedule(profile: ProviderProfile): Finding[] {
  const out: Finding[] = [];
  const schedule = profile.charges;
  if (schedule === undefined) return out;
  const cur = schedule.currency;
  for (const item of schedule.items) {
    const subject = `charge ${item.id}`;
    const services = servicesOf(profile, item.serviceIds);
    switch (item.kind) {
      case 'switching':
      case 'data-egress': {
        if (item.amountMinor === 0) break;
        if (art29Excluded(services)) {
          out.push(finding('charge-art29-excluded', 'info', REF.customBuilt, 'The charge applies only to custom-built or non-production services, to which Art. 29 does not apply (Art. 31).', subject));
          break;
        }
        const from = item.appliesFrom ?? '0000-01-01';
        const until = item.appliesUntil ?? '9999-12-31';
        if (until >= LAW.noSwitchingChargesFrom) {
          out.push(
            finding(
              'charge-after-cutover',
              'conflict',
              REF.noCharges,
              `${item.kind === 'data-egress' ? 'Data egress charges are switching charges. ' : ''}This charge can apply on or after ${LAW.noSwitchingChargesFrom}, from which no switching charges may be imposed. Set appliesUntil to ${LAST_REDUCED_CHARGE_DAY} at the latest, or the amount to 0.`,
              subject,
            ),
          );
        }
        if (from <= LAST_REDUCED_CHARGE_DAY && until >= LAW.applicationDate) out.push(...costCap(item, subject, cur, false));
        break;
      }
      case 'parallel-use-egress':
        out.push(...costCap(item, subject, cur, true));
        break;
      case 'additional-service':
        if (item.onlyOnCustomerRequest !== true || item.priceAgreedInAdvance !== true) {
          out.push(finding('additional-service-terms', 'review', REF.recitalAdditionalServices, 'Services beyond the switching obligations can be charged when performed at the customer\'s request and the price is agreed in advance (recital 89). State both for this item.', subject));
        }
        break;
      case 'early-termination-penalty':
        out.push(finding('early-termination-penalty', 'info', REF.chargesPreContract, 'Early termination penalties are not switching charges (Art. 2, point (36)), but must be disclosed before the contract (Art. 29(4)). Recital 89 refers to proportionate penalties for fixed-duration contracts.', subject));
        break;
      case 'standard-service-fee':
        break;
    }
  }
  return out;
}

/**
 * Checks the charges actually imposed in a switching request, by the day each was imposed.
 * `contractLastDay` is the last day on which the contract applies, from the timeline (`contractLastDay(timeline)`),
 * when known: standard service fees imposed later are flagged for review.
 */
export function checkAppliedCharges(profile: ProviderProfile, req: SwitchingRequest, contractLastDay?: LocalDate): Finding[] {
  const out: Finding[] = [];
  const cur = profile.charges?.currency ?? 'EUR';
  const services = servicesOf(profile, req.serviceIds);
  for (const c of req.charges) {
    const subject = `charge ${c.id}`;
    const item = c.chargeId === undefined ? undefined : profile.charges?.items.find((x) => x.id === c.chargeId);
    switch (c.kind) {
      case 'switching':
      case 'data-egress': {
        if (c.amountMinor === 0) break;
        if (art29Excluded(services)) {
          out.push(finding('charge-art29-excluded', 'info', REF.customBuilt, 'The services are custom-built or non-production; Art. 29 does not apply to them (Art. 31).', subject));
          break;
        }
        const phase = chargePhase(c.imposedOn);
        if (phase === 'free') {
          out.push(finding('charge-after-cutover', 'conflict', REF.noCharges, `A ${c.kind === 'data-egress' ? 'data egress' : 'switching'} charge is imposed on ${c.imposedOn}. From ${LAW.noSwitchingChargesFrom} no switching charges may be imposed.`, subject));
        } else if (phase === 'reduced') {
          out.push(...costCap({ amountMinor: c.amountMinor, directlyLinkedCostMinor: c.directlyLinkedCostMinor, costBasis: item?.costBasis }, subject, cur, false));
        } else {
          out.push(finding('charge-before-application', 'info', REF.application, `The charge is imposed on ${c.imposedOn}, before the Regulation applies (${LAW.applicationDate}).`, subject));
        }
        break;
      }
      case 'parallel-use-egress':
        out.push(finding('parallel-egress-in-switching', 'review', REF.parallelEgress, 'Egress charges for in-parallel use (Art. 34(2)) are not part of a switching process. Check that this charge is classified correctly; if it is a switching egress charge, Art. 29 applies.', subject));
        break;
      case 'additional-service':
        if (c.customerRequested !== true || c.priceAgreedInAdvance !== true) {
          out.push(finding('additional-service-terms', 'review', REF.recitalAdditionalServices, 'Additional services can be charged when performed at the customer\'s request at a price agreed in advance (recital 89). Record both, or treat the charge as a switching charge.', subject));
        }
        break;
      case 'early-termination-penalty':
        out.push(finding('early-termination-penalty', 'info', REF.chargesPreContract, 'Not a switching charge (Art. 2, point (36)). Check it was disclosed before the contract (Art. 29(4)).', subject));
        break;
      case 'standard-service-fee':
        if (contractLastDay !== undefined && c.imposedOn > contractLastDay) {
          out.push(finding('fee-after-contract-end', 'review', REF.termination, `A standard service fee is imposed on ${c.imposedOn}, after the contract ended (${contractLastDay}). Standard service fees remain applicable until the contract ceases to apply (Art. 25(2)(a) and (c), recital 89); check what the fee covers.`, subject));
        }
        break;
    }
  }
  return out;
}
