// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

import { LAW, REF, type ArticleRef } from '../legal/refs.ts';
import type { ProviderProfile } from '../model/profile.ts';
import type { RequestEvent, SwitchingRequest } from '../model/request.ts';
import { effectiveRegime } from '../rules/charges.ts';
import { finding, type Finding } from '../rules/findings.ts';
import { addDays, dateIn, endOfDay, startOfDay, toIso, toMs, type LocalDate } from '../time/zone.ts';
import { lastDayOfDays, lastDayOfMonths, lastDayOfWorkingDays, maxDate, minDate } from './periods.ts';

/**
 * Derived state of a switching request at a moment in time.
 * - notice: request made, notice period running.
 * - transition: transitional period running, switching not yet recorded as completed.
 * - completed: switching completed (contract terminated), agreed transitional period not yet over.
 * - retrieval: data retrieval period running.
 * - erasure-due: retrieval period over, erasure not yet confirmed.
 * - terminated: erase-only request after the notice period; erasure not yet confirmed.
 * - overdue: the transitional period ended without a recorded completion.
 * - erased, cancelled: final.
 */
export const STATES = ['notice', 'transition', 'completed', 'retrieval', 'erasure-due', 'terminated', 'overdue', 'erased', 'cancelled'] as const;
export type RequestState = (typeof STATES)[number];

export const MILESTONE_IDS = [
  'request-received',
  'unfeasibility-notice-due',
  'notice-end',
  'transition-start',
  'transition-end',
  'switching-completed',
  'termination',
  'retrieval-end',
  'erasure-from',
  'erasure-confirmed',
  'charges-free-from',
] as const;
export type MilestoneId = (typeof MILESTONE_IDS)[number];

/**
 * - upcoming: in the future.
 * - due: the date has arrived and an action is outstanding.
 * - done: the action was recorded in time.
 * - late: the action was recorded after the date, or the date passed without it.
 * - passed: the date has passed; nothing had to be recorded.
 * - cancelled: the request was withdrawn before this date.
 */
export type MilestoneStatus = 'upcoming' | 'due' | 'done' | 'late' | 'passed' | 'cancelled';

export interface Milestone {
  readonly id: MilestoneId;
  readonly label: string;
  readonly ref: ArticleRef;
  /** The calendar day in the profile's time zone (the last day of a period, or the day of an event). */
  readonly date: LocalDate;
  /** The instant: the end (exclusive) of the last day for period ends, the start of the day for starts, the time of events. */
  readonly at: string;
  readonly status: MilestoneStatus;
  /** How the date was worked out. */
  readonly basis: string;
}

export interface Period {
  readonly firstDay: LocalDate;
  readonly lastDay: LocalDate;
}

export interface Timeline {
  readonly requestId: string;
  readonly timeZone: string;
  /** The moment the timeline was computed for. */
  readonly now: string;
  readonly state: RequestState;
  readonly receivedDay: LocalDate;
  readonly notice: Period & { readonly source: 'contract' | 'statutory-maximum'; readonly statutoryLastDay: LocalDate };
  /** Absent for erase-only requests. */
  readonly transition?: Period & {
    /** Last day without extensions. */
    readonly standardLastDay: LocalDate;
    /** Latest last day of an alternative transitional period (seven months, Art. 25(4)). */
    readonly alternativeCapLastDay: LocalDate;
    readonly extendedBy: readonly ('provider-unfeasibility' | 'customer')[];
    /**
     * A later end that is not the provider's deadline: an alternative period notified after the 14 working days
     * (Art. 25(4)) or an extension recorded after the transitional period ended (Art. 25(5), recital 87). The
     * retrieval period starts after it, so the customer loses no retrieval time.
     */
    readonly disregardedLastDay?: LocalDate;
  };
  /** Last day for the provider to notify technical unfeasibility; absent for erase-only requests. */
  readonly unfeasibilityNoticeDue?: LocalDate;
  readonly retrieval?: Period & { readonly days: number };
  /** First day on which erasure takes place under Art. 25(2)(h). */
  readonly erasureFrom: LocalDate;
  readonly milestones: readonly Milestone[];
  readonly findings: readonly Finding[];
  /** Notes on how the law was read; always included so users see the assumptions. */
  readonly assumptions: readonly string[];
}

export interface TimelineOptions {
  /** The moment to evaluate statuses at (default: now). */
  readonly now?: number;
}

function eventOf<T extends RequestEvent['type']>(req: SwitchingRequest, type: T): Extract<RequestEvent, { type: T }> | undefined {
  return req.events.find((e): e is Extract<RequestEvent, { type: T }> => e.type === type);
}

/** Days of the transitional period agreed in the contract, capped at the statutory 30 (Art. 25(2)(a)). */
function transitionDays(profile: ProviderProfile, findings: Finding[]): number {
  const agreed = profile.contract?.transitionDays;
  if (agreed === undefined) return LAW.maxTransitionDays;
  if (agreed > LAW.maxTransitionDays) {
    findings.push(finding('transition-too-long', 'conflict', REF.switchClause, `The contract's transitional period of ${agreed} days exceeds the maximum of ${LAW.maxTransitionDays} calendar days; the timeline uses ${LAW.maxTransitionDays}.`));
    return LAW.maxTransitionDays;
  }
  return agreed;
}

/**
 * Works out every statutory date of a switching request and its state at `now`.
 *
 * Pure function: same profile, request and `now` give the same result. It never throws on unusual but
 * structurally valid data; problems are returned as findings. Validate inputs first with `validateProfile` /
 * `validateRequest`.
 *
 * @example
 * const t = computeTimeline(profile, request, { now: Date.parse('2026-03-01T00:00:00Z') });
 * t.transition?.lastDay; // last day of the transitional period
 */
export function computeTimeline(profile: ProviderProfile, req: SwitchingRequest, opts: TimelineOptions = {}): Timeline {
  const zone = profile.timeZone;
  const nowMs = opts.now ?? Date.now();
  const findings: Finding[] = [];
  const assumptions: string[] = [
    `Calendar days are counted in the time zone ${zone}. A period running from an event does not count the day of the event and ends at the end of its last day.`,
  ];
  const holidays = new Set(profile.workingDays?.publicHolidays ?? []);
  const receivedMs = toMs(req.receivedAt);
  const receivedDay = dateIn(receivedMs, zone);
  const erase = req.target.kind === 'erase';
  const cancelled = eventOf(req, 'cancelled');
  const completed = eventOf(req, 'switching-completed');
  const erased = eventOf(req, 'erasure-confirmed');
  const unfeasible = eventOf(req, 'unfeasibility-notified');
  const extension = eventOf(req, 'customer-extension');
  const contract = profile.contract;

  if (receivedDay < LAW.applicationDate) {
    findings.push(finding('before-application', 'info', REF.application, `The request was made before ${LAW.applicationDate}, the date from which the Regulation applies (Art. 50). The statutory periods may not apply.`));
  }
  for (const sid of req.serviceIds) {
    const s = profile.services.find((x) => x.id === sid);
    if (s?.regime === 'non-production') findings.push(finding('regime-non-production', 'info', REF.nonProduction, `Service "${s.name}" is a non-production version for testing and evaluation: the obligations of Chapter VI do not apply to it (Art. 31(2)).`, sid));
    if (s !== undefined && effectiveRegime(s) === 'custom-built') findings.push(finding('regime-custom-built', 'info', REF.customBuilt, `Service "${s.name}" is custom-built: Art. 23(d), Art. 29 and Art. 30(1) and (3) do not apply to it (Art. 31(1)). The periods of Art. 25 still apply.`, sid));
  }

  // --- Notice period, Art. 25(2)(d): at most two months from the request.
  const statutoryNoticeLast = lastDayOfMonths(receivedDay, LAW.maxNoticeMonths);
  let noticeLast = statutoryNoticeLast;
  let noticeSource: 'contract' | 'statutory-maximum' = 'statutory-maximum';
  const np = contract?.noticePeriod;
  if (np === undefined) {
    findings.push(finding('notice-period-not-stated', 'missing', REF.noticePeriod, 'The profile states no notice period; the timeline uses the statutory maximum of two months.'));
  } else {
    const contractLast = np.unit === 'days' ? lastDayOfDays(receivedDay, np.value) : lastDayOfMonths(receivedDay, np.value);
    if (contractLast > statutoryNoticeLast) {
      findings.push(finding('notice-period-too-long', 'conflict', REF.noticePeriod, `The contract's notice period (${np.value} ${np.unit}) ends on ${contractLast}, after the two-month maximum (${statutoryNoticeLast}). The timeline uses the maximum.`));
    } else {
      noticeLast = contractLast;
      noticeSource = 'contract';
    }
  }
  const notice = { firstDay: addDays(receivedDay, 1), lastDay: noticeLast, source: noticeSource, statutoryLastDay: statutoryNoticeLast };
  if (np !== undefined && np.value === 0) notice.firstDay = receivedDay;

  const milestones: Milestone[] = [];
  const at = (day: LocalDate): string => toIso(startOfDay(day, zone));
  const endAt = (day: LocalDate): string => toIso(endOfDay(day, zone));
  const passed = (day: LocalDate): boolean => nowMs >= endOfDay(day, zone);
  const started = (day: LocalDate): boolean => nowMs >= startOfDay(day, zone);
  // A withdrawn request has nothing outstanding: open milestones become "cancelled".
  const push = (m: Milestone): void => {
    milestones.push(cancelled !== undefined && (m.status === 'upcoming' || m.status === 'due') ? { ...m, status: 'cancelled' } : m);
  };

  push({ id: 'request-received', label: 'Switching request made', ref: REF.customerOptions, date: receivedDay, at: req.receivedAt, status: 'done', basis: 'Recorded time of the request.' });

  let transition: Timeline['transition'];
  let unfeasibilityDue: LocalDate | undefined;
  let retrieval: Timeline['retrieval'];
  let erasureFrom: LocalDate;

  if (erase) {
    // Art. 25(2)(c)(ii): the contract is terminated at the end of the maximum notice period when the customer chose erasure.
    push({ id: 'notice-end', label: 'End of the notice period', ref: REF.noticePeriod, date: noticeLast, at: endAt(noticeLast), status: passed(noticeLast) ? 'passed' : 'upcoming', basis: noticeBasis(np, noticeSource) });
    push({ id: 'termination', label: 'Contract terminated (customer chose erasure)', ref: REF.terminationOnErase, date: noticeLast, at: endAt(noticeLast), status: passed(noticeLast) ? 'passed' : 'upcoming', basis: 'Art. 25(2)(c)(ii): at the end of the maximum notice period.' });
    erasureFrom = addDays(noticeLast, 1);
    assumptions.push('Erase-only request: the Regulation sets no retrieval period here, because the customer chose to erase rather than port (Art. 25(3)(c)). Erasure is shown from the day after the contract ends.');
  } else {
    // --- Working-day deadline, Art. 25(4).
    unfeasibilityDue = lastDayOfWorkingDays(receivedDay, LAW.unfeasibilityNoticeWorkingDays, holidays);
    assumptions.push(
      holidays.size === 0
        ? 'Working days are Monday to Friday. No public holidays are listed in the profile, so none are excluded; this gives the earliest possible date for the 14-working-day notification.'
        : `Working days are Monday to Friday except the ${holidays.size} public holiday(s) listed in the profile${profile.workingDays?.calendarName === undefined ? '' : ` (${profile.workingDays.calendarName})`}.`,
    );
    const unfeasStatus: MilestoneStatus =
      unfeasible !== undefined ? (toMs(unfeasible.at) < endOfDay(unfeasibilityDue, zone) ? 'done' : 'late') : passed(unfeasibilityDue) ? 'passed' : 'upcoming';
    push({ id: 'unfeasibility-notice-due', label: 'Last day to notify technical unfeasibility', ref: REF.unfeasibility, date: unfeasibilityDue, at: endAt(unfeasibilityDue), status: unfeasStatus, basis: `${LAW.unfeasibilityNoticeWorkingDays} working days from the day of the request.` });
    if (unfeasible !== undefined && unfeasStatus === 'late') {
      findings.push(finding('unfeasibility-notified-late', 'conflict', REF.unfeasibility, `Technical unfeasibility was notified on ${dateIn(toMs(unfeasible.at), zone)}, after the last day (${unfeasibilityDue}) of the ${LAW.unfeasibilityNoticeWorkingDays} working days. A provider that notified late cannot rely on the alternative period: the timeline keeps the standard end of the transitional period as the deadline, and starts the retrieval period after the later alternative end, so the customer loses no retrieval time.`));
    }

    push({ id: 'notice-end', label: 'End of the notice period', ref: REF.noticePeriod, date: noticeLast, at: endAt(noticeLast), status: passed(noticeLast) ? 'passed' : 'upcoming', basis: noticeBasis(np, noticeSource) });

    // --- Transitional period, Art. 25(2)(a): initiated after the notice period, at most 30 calendar days.
    let anchor = noticeLast;
    if (req.transitionStartDate !== undefined) {
      if (req.transitionStartDate <= receivedDay) {
        findings.push(finding('transition-start-before-request', 'conflict', REF.switchClause, `The agreed start of the transitional period (${req.transitionStartDate}) is not after the day of the request (${receivedDay}); it is ignored.`));
      } else {
        anchor = addDays(req.transitionStartDate, -1);
        if (req.transitionStartDate > addDays(noticeLast, 1)) {
          findings.push(finding('transition-start-after-notice', 'review', REF.switchClause, `The agreed start of the transitional period (${req.transitionStartDate}) is later than the day after the notice period (${addDays(noticeLast, 1)}). Art. 25(2)(a) has it initiated after the maximum notice period; keep a record that the customer chose the later start.`));
        }
      }
    }
    const firstDay = addDays(anchor, 1);
    const standardLast = lastDayOfDays(anchor, transitionDays(profile, findings));
    const capLast = lastDayOfMonths(anchor, LAW.maxAlternativeTransitionMonths);
    let lastDay = standardLast;
    // The latest end that was notified or recorded but is not relied on as the deadline (see LEGAL.md, choices 9, 10).
    let disregarded: LocalDate | undefined;
    const extendedBy: ('provider-unfeasibility' | 'customer')[] = [];
    if (unfeasible !== undefined) {
      const alt = unfeasible.alternativeTransitionEnd;
      if (alt > capLast) {
        findings.push(finding('alternative-period-too-long', 'conflict', REF.unfeasibility, `The alternative transitional period ends on ${alt}, beyond the seven-month maximum (${capLast}). The timeline uses ${capLast}.`));
      }
      if (alt <= standardLast) {
        findings.push(finding('alternative-period-not-longer', 'review', REF.unfeasibility, `The alternative transitional period (to ${alt}) is not longer than the standard one (to ${standardLast}).`));
      }
      const altLast = maxDate(standardLast, minDate(alt, capLast));
      if (unfeasStatus === 'late') {
        // Art. 25(4): notification "within 14 working days". A provider that notified late cannot rely on the
        // alternative period: its deadline stays the standard end. The customer keeps retrieval time after the
        // alternative end it was told about.
        if (altLast > standardLast) disregarded = altLast;
      } else {
        lastDay = altLast;
        if (lastDay > standardLast) extendedBy.push('provider-unfeasibility');
      }
    }
    if (extension !== undefined) {
      // Art. 25(5); recital 87: the customer may extend once, before or during the transitional period. No maximum is set.
      if (toMs(extension.at) >= endOfDay(lastDay, zone)) {
        // Art. 25(5) extends "the transitional period"; recital 87: "prior to or during" it. An ended period cannot
        // be extended, so the deadline stays; the customer keeps retrieval time after the new end it named.
        findings.push(finding('extension-after-transition', 'conflict', REF.customerExtension, `The customer's extension was recorded on ${dateIn(toMs(extension.at), zone)}, after the transitional period ended (${lastDay}). Recital 87: the right is used before or during the transitional period. The timeline keeps ${lastDay} as the end of the transitional period; the retrieval period starts after ${maxDate(extension.newTransitionEnd, lastDay)}.`));
        if (extension.newTransitionEnd > lastDay) disregarded = maxDate(disregarded ?? extension.newTransitionEnd, extension.newTransitionEnd);
      } else if (extension.newTransitionEnd <= lastDay) {
        findings.push(finding('extension-not-longer', 'review', REF.customerExtension, `The customer's new end of the transitional period (${extension.newTransitionEnd}) is not after the current end (${lastDay}).`));
      } else {
        lastDay = extension.newTransitionEnd;
        extendedBy.push('customer');
      }
    }
    transition = { firstDay, lastDay, standardLastDay: standardLast, alternativeCapLastDay: capLast, extendedBy, ...(disregarded === undefined || disregarded <= lastDay ? {} : { disregardedLastDay: disregarded }) };
    push({ id: 'transition-start', label: 'Start of the transitional period', ref: REF.switchClause, date: firstDay, at: at(firstDay), status: started(firstDay) ? 'passed' : 'upcoming', basis: req.transitionStartDate !== undefined && anchor !== noticeLast ? 'Agreed start date.' : 'Day after the notice period ends.' });
    const transitionStatus: MilestoneStatus =
      completed !== undefined ? (toMs(completed.at) < endOfDay(lastDay, zone) ? 'done' : 'late') : cancelled !== undefined ? 'cancelled' : passed(lastDay) ? 'late' : 'upcoming';
    push({ id: 'transition-end', label: 'Switching completed at the latest (end of the transitional period)', ref: REF.switchClause, date: lastDay, at: endAt(lastDay), status: transitionStatus, basis: transitionBasis(standardLast, extendedBy) });
    if (completed !== undefined) {
      push({ id: 'switching-completed', label: 'Switching completed; contract terminated', ref: REF.terminationOnSwitch, date: dateIn(toMs(completed.at), zone), at: completed.at, status: 'done', basis: 'Recorded completion.' });
      if (transitionStatus === 'late') findings.push(finding('completed-late', 'conflict', REF.switchClause, `Switching was recorded as completed after the transitional period ended (${lastDay}).`));
    } else if (transitionStatus === 'late') {
      findings.push(finding('transition-overdue', 'conflict', REF.switchClause, `The transitional period ended on ${lastDay} and no completion of the switching is recorded.`));
    }

    // --- Retrieval period, Art. 25(2)(g): at least 30 calendar days, after the transitional period ends.
    let days = req.retrievalDays ?? contract?.retrievalDays ?? LAW.minRetrievalDays;
    if (days < LAW.minRetrievalDays) {
      findings.push(finding('retrieval-too-short', 'conflict', REF.retrieval, `A data retrieval period of ${days} days is shorter than the minimum of ${LAW.minRetrievalDays} calendar days; the timeline uses ${LAW.minRetrievalDays}.`));
      days = LAW.minRetrievalDays;
    }
    if (req.retrievalDays === undefined && contract?.retrievalDays === undefined) {
      findings.push(finding('retrieval-not-stated', 'missing', REF.retrieval, `No data retrieval period is stated; the timeline uses the minimum of ${LAW.minRetrievalDays} calendar days.`));
    }
    // Art. 25(2)(g): after the transitional period; after the later disregarded end if there is one.
    const retrievalAnchor = transition.disregardedLastDay ?? lastDay;
    const rLast = lastDayOfDays(retrievalAnchor, days);
    retrieval = { firstDay: addDays(retrievalAnchor, 1), lastDay: rLast, days };
    assumptions.push('The retrieval period starts after the end of the agreed transitional period, including any extension, even when switching completes earlier. This never gives an earlier erasure date than the alternative reading.');
    push({ id: 'retrieval-end', label: 'End of the data retrieval period', ref: REF.retrieval, date: rLast, at: endAt(rLast), status: passed(rLast) ? 'passed' : 'upcoming', basis: transition.disregardedLastDay === undefined ? `${days} calendar days after the transitional period.` : `${days} calendar days after ${transition.disregardedLastDay}, the later end notified or recorded (not relied on as the deadline).` });
    erasureFrom = addDays(rLast, 1);
  }

  // --- Erasure, Art. 25(2)(h): after the retrieval period, or after a later agreed date.
  if (req.erasureNotBefore !== undefined) {
    if (req.erasureNotBefore < erasureFrom) {
      findings.push(finding('erasure-date-too-early', 'conflict', REF.erasure, `The agreed erasure date (${req.erasureNotBefore}) is not later than the end of the retrieval period; it is ignored.`));
    } else {
      erasureFrom = req.erasureNotBefore;
    }
  }
  const erasureStatus: MilestoneStatus = erased !== undefined ? 'done' : started(erasureFrom) ? 'due' : 'upcoming';
  push({ id: 'erasure-from', label: 'Erasure of exportable data and digital assets', ref: REF.erasure, date: erasureFrom, at: at(erasureFrom), status: erasureStatus, basis: req.erasureNotBefore !== undefined && erasureFrom === req.erasureNotBefore ? 'Agreed later date.' : erase ? 'Day after the contract ends.' : 'Day after the retrieval period ends.' });
  if (erased !== undefined) {
    push({ id: 'erasure-confirmed', label: 'Erasure confirmed', ref: REF.erasure, date: dateIn(toMs(erased.at), zone), at: erased.at, status: 'done', basis: 'Recorded confirmation.' });
    if (toMs(erased.at) < startOfDay(erasureFrom, zone)) {
      findings.push(finding('erased-before-retrieval-end', 'review', REF.erasure, `Erasure was confirmed on ${dateIn(toMs(erased.at), zone)}, before ${erasureFrom}. Art. 25(2)(h) provides for erasure after the retrieval period; check that the customer agreed.`));
    }
    if (!erase && completed === undefined) {
      findings.push(finding('erased-without-completion', 'review', REF.erasure, 'Erasure was confirmed but no successful completion of switching is recorded. Art. 25(2)(h) ties erasure to a completed switching process.'));
    }
  }

  // --- Switching charges, Art. 29(1): none from 12 January 2027.
  if (receivedDay < LAW.noSwitchingChargesFrom && erasureFrom >= LAW.noSwitchingChargesFrom) {
    push({ id: 'charges-free-from', label: 'No switching charges from this day', ref: REF.noCharges, date: LAW.noSwitchingChargesFrom, at: at(LAW.noSwitchingChargesFrom), status: started(LAW.noSwitchingChargesFrom) ? 'passed' : 'upcoming', basis: 'Art. 29(1).' });
  }

  milestones.sort((a, b) => toMs(a.at) - toMs(b.at) || MILESTONE_IDS.indexOf(a.id) - MILESTONE_IDS.indexOf(b.id));
  return {
    requestId: req.id,
    timeZone: zone,
    now: toIso(nowMs),
    state: stateOf(req, nowMs, zone, { noticeLast, transition, retrieval, erasureFrom }),
    receivedDay,
    notice,
    ...(transition === undefined ? {} : { transition }),
    ...(unfeasibilityDue === undefined ? {} : { unfeasibilityNoticeDue: unfeasibilityDue }),
    ...(retrieval === undefined ? {} : { retrieval }),
    erasureFrom,
    milestones,
    findings,
    assumptions,
  };
}

/**
 * The last day on which the contract applies: for an erase-only request the last day of the notice period
 * (Art. 25(2)(c)(ii)); otherwise the day switching was recorded as completed (Art. 25(2)(c)(i)) or, if that is
 * later or not recorded, the last day of the transitional period, during which the contract remains applicable
 * (Art. 25(2)(a)).
 */
export function contractLastDay(t: Timeline): LocalDate {
  if (t.transition === undefined) return t.notice.lastDay;
  const done = t.milestones.find((m) => m.id === 'switching-completed');
  return done === undefined ? t.transition.lastDay : minDate(done.date, t.transition.lastDay);
}

function noticeBasis(np: { unit: string; value: number } | undefined, source: 'contract' | 'statutory-maximum'): string {
  return source === 'contract' && np !== undefined ? `Contract notice period of ${np.value} ${np.unit} from the day of the request.` : 'Statutory maximum of two months from the day of the request.';
}

function transitionBasis(standardLast: LocalDate, extendedBy: readonly string[]): string {
  if (extendedBy.length === 0) return 'Transitional period of the contract (at most 30 calendar days).';
  const parts = extendedBy.map((e) => (e === 'customer' ? 'extended by the customer (Art. 25(5))' : 'alternative period after technical unfeasibility (Art. 25(4))'));
  return `Standard end ${standardLast}; ${parts.join(', then ')}.`;
}

function stateOf(
  req: SwitchingRequest,
  nowMs: number,
  zone: string,
  p: { noticeLast: LocalDate; transition: Timeline['transition']; retrieval: Timeline['retrieval']; erasureFrom: LocalDate },
): RequestState {
  if (req.events.some((e) => e.type === 'erasure-confirmed')) return 'erased';
  if (req.events.some((e) => e.type === 'cancelled')) return 'cancelled';
  if (req.target.kind === 'erase' || p.transition === undefined) return nowMs < endOfDay(p.noticeLast, zone) ? 'notice' : 'terminated';
  const completed = req.events.some((e) => e.type === 'switching-completed');
  const transitionEnd = endOfDay(p.transition.lastDay, zone);
  if (!completed) {
    if (nowMs < startOfDay(p.transition.firstDay, zone)) return 'notice';
    return nowMs < transitionEnd ? 'transition' : 'overdue';
  }
  /* v8 ignore next 2 -- retrieval is always set when a transition is */
  const retrievalStart = p.retrieval === undefined ? transitionEnd : startOfDay(p.retrieval.firstDay, zone);
  const retrievalEnd = p.retrieval === undefined ? transitionEnd : endOfDay(p.retrieval.lastDay, zone);
  if (nowMs < retrievalStart) return 'completed';
  return nowMs < retrievalEnd ? 'retrieval' : 'erasure-due';
}
