// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { computeTimeline, contractLastDay, type Timeline } from '../src/engine/timeline.ts';
import { ms, profile, request } from './helpers.ts';

const NOW = ms('2026-11-08T12:00:00Z');

function tl(req: Record<string, unknown> = {}, prof: Record<string, unknown> = {}, now = NOW): Timeline {
  return computeTimeline(profile(prof), request(req), { now });
}

function milestone(t: Timeline, id: string): { date: string; status: string; at: string } {
  const m = t.milestones.find((x) => x.id === id);
  if (m === undefined) throw new Error(`no milestone ${id}`);
  return m;
}

function codes(t: Timeline): string[] {
  return t.findings.map((f) => f.code);
}

/** Received at 10:00 Vilnius time on `day`. */
function at(day: string): string {
  const offset = day >= '2026-03-29' && day < '2026-10-25' ? '07' : '08';
  return `${day}T${offset}:00:00.000Z`;
}

describe('notice period (Art. 25(2)(d))', () => {
  it('ends two months after the day of the request, at the end of that day', () => {
    const t = tl({ receivedAt: at('2026-10-30') });
    expect(t.notice).toMatchObject({ firstDay: '2026-10-31', lastDay: '2026-12-30', source: 'contract', statutoryLastDay: '2026-12-30' });
    expect(milestone(t, 'notice-end').at).toBe('2026-12-30T22:00:00.000Z');
  });

  it.each([
    ['2026-12-31', '2027-02-28'],
    ['2027-12-31', '2028-02-29'],
    ['2026-08-31', '2026-10-31'],
    ['2026-07-31', '2026-09-30'],
    ['2026-03-31', '2026-05-31'],
    ['2026-04-30', '2026-06-30'],
    ['2027-01-29', '2027-03-29'],
  ])('request on %s: notice ends %s (month-end rule)', (day, last) => {
    const t = tl({ receivedAt: at(day) }, {}, ms('2028-12-31T00:00:00Z'));
    expect(t.notice.lastDay).toBe(last);
  });

  it('uses the request day in the profile time zone, not in UTC', () => {
    // 23:30 UTC on 30 October is already 31 October in Vilnius.
    expect(tl({ receivedAt: '2026-10-30T23:30:00.000Z' }).receivedDay).toBe('2026-10-31');
    expect(tl({ receivedAt: '2026-10-30T21:59:59.999Z' }).receivedDay).toBe('2026-10-30');
    expect(tl({ receivedAt: '2026-10-30T22:00:00.000Z' }).receivedDay).toBe('2026-10-31');
    expect(tl({ receivedAt: '2026-10-30T23:30:00.000Z' }, { timeZone: 'UTC' }).receivedDay).toBe('2026-10-30');
  });

  it('applies a shorter contract notice period in days or months', () => {
    expect(tl({ receivedAt: at('2026-10-30') }, { 'contract.noticePeriod': { unit: 'days', value: 30 } }).notice.lastDay).toBe('2026-11-29');
    expect(tl({ receivedAt: at('2026-10-31') }, { 'contract.noticePeriod': { unit: 'months', value: 1 } }).notice.lastDay).toBe('2026-11-30');
    const zero = tl({ receivedAt: at('2026-10-30') }, { 'contract.noticePeriod': { unit: 'days', value: 0 } });
    expect(zero.notice).toMatchObject({ firstDay: '2026-10-30', lastDay: '2026-10-30' });
    expect(zero.transition?.firstDay).toBe('2026-10-31');
  });

  it('caps a contract notice period longer than two months and flags it', () => {
    const t = tl({ receivedAt: at('2026-10-30') }, { 'contract.noticePeriod': { unit: 'months', value: 3 } });
    expect(t.notice).toMatchObject({ lastDay: '2026-12-30', source: 'statutory-maximum' });
    expect(codes(t)).toContain('notice-period-too-long');
  });

  it('flags 62 days only when they exceed two months for that request date', () => {
    const p = { 'contract.noticePeriod': { unit: 'days', value: 62 } };
    // From 1 July: two months end 1 September = 62 days. Fine.
    expect(codes(tl({ receivedAt: at('2026-07-01') }, p, ms('2027-01-01T00:00:00Z')))).not.toContain('notice-period-too-long');
    // From 30 December: two months end 28 February = 60 days. 62 days is too long.
    const t = tl({ receivedAt: at('2026-12-30') }, p, ms('2027-01-01T00:00:00Z'));
    expect(codes(t)).toContain('notice-period-too-long');
    expect(t.notice.lastDay).toBe('2027-02-28');
  });

  it('uses the statutory maximum when no notice period is stated', () => {
    const t = tl({ receivedAt: at('2026-10-30') }, { 'contract.noticePeriod': undefined });
    expect(t.notice.source).toBe('statutory-maximum');
    expect(codes(t)).toContain('notice-period-not-stated');
  });
});

describe('transitional period (Art. 25(2)(a))', () => {
  it('starts the day after the notice period and lasts 30 calendar days', () => {
    const t = tl({ receivedAt: at('2026-10-30') });
    expect(t.transition).toMatchObject({ firstDay: '2026-12-31', lastDay: '2027-01-29', standardLastDay: '2027-01-29' });
    expect(milestone(t, 'transition-start').at).toBe('2026-12-30T22:00:00.000Z');
    expect(milestone(t, 'transition-end').at).toBe('2027-01-29T22:00:00.000Z');
  });

  it('ends at local midnight across the spring DST change', () => {
    // Notice ends 27 February 2026 (request 27 December 2025); transition 28 Feb .. 29 March (23-hour day).
    const t = tl({ receivedAt: at('2025-12-27') }, {}, ms('2025-12-28T00:00:00Z'));
    expect(t.transition?.lastDay).toBe('2026-03-29');
    expect(milestone(t, 'transition-end').at).toBe('2026-03-29T21:00:00.000Z');
  });

  it('ends at local midnight across the autumn DST change', () => {
    const t = tl({ receivedAt: at('2026-07-25') }, {}, ms('2026-07-27T00:00:00Z'));
    expect(t.transition?.lastDay).toBe('2026-10-25');
    expect(milestone(t, 'transition-end').at).toBe('2026-10-25T22:00:00.000Z');
  });

  it('applies a shorter contract period and caps a longer one at 30 days', () => {
    expect(tl({ receivedAt: at('2026-10-30') }, { 'contract.transitionDays': 20 }).transition?.lastDay).toBe('2027-01-19');
    const t = tl({ receivedAt: at('2026-10-30') }, { 'contract.transitionDays': 45 });
    expect(t.transition?.lastDay).toBe('2027-01-29');
    expect(codes(t)).toContain('transition-too-long');
  });

  it('uses an agreed later start date and asks for a record of the choice', () => {
    const t = tl({ receivedAt: at('2026-10-30'), transitionStartDate: '2027-01-15' });
    expect(t.transition).toMatchObject({ firstDay: '2027-01-15', lastDay: '2027-02-13' });
    expect(codes(t)).toContain('transition-start-after-notice');
  });

  it('accepts an earlier agreed start and ignores one not after the request', () => {
    const early = tl({ receivedAt: at('2026-10-30'), transitionStartDate: '2026-11-02' });
    expect(early.transition).toMatchObject({ firstDay: '2026-11-02', lastDay: '2026-12-01' });
    expect(codes(early)).not.toContain('transition-start-after-notice');
    const bad = tl({ receivedAt: at('2026-10-30'), transitionStartDate: '2026-10-30' });
    expect(bad.transition?.firstDay).toBe('2026-12-31');
    expect(codes(bad)).toContain('transition-start-before-request');
  });
});

describe('technical unfeasibility (Art. 25(4))', () => {
  it('sets the notification deadline 14 working days after the request', () => {
    // Friday 30 October 2026; Monday 2 November is a listed public holiday in the example profile.
    const t = tl({ receivedAt: at('2026-10-30') });
    expect(t.unfeasibilityNoticeDue).toBe('2026-11-20');
    expect(milestone(t, 'unfeasibility-notice-due')).toMatchObject({ status: 'upcoming', at: '2026-11-20T22:00:00.000Z' });
  });

  it('skips listed public holidays and weekends', () => {
    // Request Friday 18 December 2026; 24, 25 December and 1 January are listed holidays.
    expect(tl({ receivedAt: at('2026-12-18') }, {}, ms('2026-12-19T00:00:00Z')).unfeasibilityNoticeDue).toBe('2027-01-12');
    expect(tl({ receivedAt: at('2026-12-18') }, { 'workingDays.publicHolidays': [] }, ms('2026-12-19T00:00:00Z')).unfeasibilityNoticeDue).toBe('2027-01-07');
  });

  it('notes the working-day reading in the assumptions', () => {
    expect(tl({}, { workingDays: undefined }).assumptions.join(' ')).toMatch(/No public holidays are listed/);
    expect(tl().assumptions.join(' ')).toMatch(/8 public holiday/);
  });

  it('extends the transitional period up to seven months', () => {
    const t = tl({ receivedAt: at('2026-10-30'), events: [{ type: 'unfeasibility-notified', at: '2026-11-05T10:00:00.000Z', reasons: 'r', alternativeTransitionEnd: '2027-05-31' }] });
    expect(t.transition).toMatchObject({ lastDay: '2027-05-31', alternativeCapLastDay: '2027-07-30', extendedBy: ['provider-unfeasibility'] });
    expect(milestone(t, 'unfeasibility-notice-due').status).toBe('done');
    expect(t.retrieval).toMatchObject({ firstDay: '2027-06-01', lastDay: '2027-06-30' });
  });

  it('caps the alternative period at seven months, clamping to the month end', () => {
    // Notice ends 31 July 2026 (request 31 May 2026): seven months end 28 February 2027.
    const t = tl({ receivedAt: at('2026-05-31'), events: [{ type: 'unfeasibility-notified', at: at('2026-06-01'), reasons: 'r', alternativeTransitionEnd: '2027-03-31' }] }, {}, ms('2026-06-02T00:00:00Z'));
    expect(t.transition).toMatchObject({ alternativeCapLastDay: '2027-02-28', lastDay: '2027-02-28' });
    expect(codes(t)).toContain('alternative-period-too-long');
  });

  it('flags a late notification on the day after the deadline, not on the deadline', () => {
    const onTime = tl({ receivedAt: at('2026-10-30'), events: [{ type: 'unfeasibility-notified', at: '2026-11-20T21:59:59.999Z', reasons: 'r', alternativeTransitionEnd: '2027-03-31' }] });
    expect(milestone(onTime, 'unfeasibility-notice-due').status).toBe('done');
    const late = tl({ receivedAt: at('2026-10-30'), events: [{ type: 'unfeasibility-notified', at: '2026-11-20T22:00:00.000Z', reasons: 'r', alternativeTransitionEnd: '2027-03-31' }] });
    expect(milestone(late, 'unfeasibility-notice-due').status).toBe('late');
    expect(codes(late)).toContain('unfeasibility-notified-late');
    // A late notice does not move the provider's deadline; the customer keeps retrieval time after the later end.
    expect(late.transition).toMatchObject({ lastDay: '2027-01-29', standardLastDay: '2027-01-29', disregardedLastDay: '2027-03-31', extendedBy: [] });
    expect(late.retrieval).toMatchObject({ firstDay: '2027-04-01', lastDay: '2027-04-30' });
    expect(late.erasureFrom).toBe('2027-05-01');
    expect(onTime.transition).toMatchObject({ lastDay: '2027-03-31', extendedBy: ['provider-unfeasibility'] });
    expect(onTime.transition?.disregardedLastDay).toBeUndefined();
    expect(onTime.retrieval).toMatchObject({ firstDay: '2027-04-01', lastDay: '2027-04-30' });
  });

  it('never shows a switch completed after the standard end as done when the notice was late', () => {
    const lateNotice = { type: 'unfeasibility-notified', at: '2026-11-20T22:00:00.000Z', reasons: 'r', alternativeTransitionEnd: '2027-03-31' };
    const events = [lateNotice, { type: 'switching-completed', at: '2027-03-15T10:00:00.000Z' }];
    const t = tl({ receivedAt: at('2026-10-30'), events }, {}, ms('2027-03-20T10:00:00Z'));
    expect(milestone(t, 'transition-end')).toMatchObject({ date: '2027-01-29', status: 'late' });
    expect(codes(t)).toEqual(expect.arrayContaining(['unfeasibility-notified-late', 'completed-late']));
    // Completed, and the retrieval period has not started yet (it starts after 31 March).
    expect(t.state).toBe('completed');
    expect(tl({ receivedAt: at('2026-10-30'), events }, {}, ms('2027-04-02T10:00:00Z')).state).toBe('retrieval');
    // Not completed by the standard end: overdue, even inside the alternative period.
    expect(tl({ receivedAt: at('2026-10-30'), events: [lateNotice] }, {}, ms('2027-02-15T10:00:00Z')).state).toBe('overdue');
    // Completed within the standard end: done.
    const early = tl({ receivedAt: at('2026-10-30'), events: [lateNotice, { type: 'switching-completed', at: '2027-01-15T10:00:00.000Z' }] }, {}, ms('2027-01-20T10:00:00Z'));
    expect(milestone(early, 'transition-end').status).toBe('done');
    expect(early.retrieval?.firstDay).toBe('2027-04-01');
  });

  it('lets a timely customer extension follow a late notice', () => {
    const t = tl({ receivedAt: at('2026-10-30'), events: [
      { type: 'unfeasibility-notified', at: '2026-11-20T22:00:00.000Z', reasons: 'r', alternativeTransitionEnd: '2027-03-31' },
      { type: 'customer-extension', at: '2026-12-01T10:00:00.000Z', newTransitionEnd: '2027-04-30' },
    ] });
    expect(t.transition).toMatchObject({ lastDay: '2027-04-30', extendedBy: ['customer'] });
    expect(t.transition?.disregardedLastDay).toBeUndefined();
    expect(t.retrieval?.firstDay).toBe('2027-05-01');
    // An extension shorter than the disregarded alternative end: deadline from the extension, retrieval after the later end.
    const shorter = tl({ receivedAt: at('2026-10-30'), events: [
      { type: 'unfeasibility-notified', at: '2026-11-20T22:00:00.000Z', reasons: 'r', alternativeTransitionEnd: '2027-03-31' },
      { type: 'customer-extension', at: '2026-12-01T10:00:00.000Z', newTransitionEnd: '2027-02-28' },
    ] });
    expect(shorter.transition).toMatchObject({ lastDay: '2027-02-28', disregardedLastDay: '2027-03-31' });
    expect(shorter.retrieval?.firstDay).toBe('2027-04-01');
  });

  it('flags an alternative period that is not longer than the standard one', () => {
    const t = tl({ receivedAt: at('2026-10-30'), events: [{ type: 'unfeasibility-notified', at: at('2026-11-02'), reasons: 'r', alternativeTransitionEnd: '2027-01-20' }] });
    expect(t.transition?.lastDay).toBe('2027-01-29');
    expect(codes(t)).toContain('alternative-period-not-longer');
  });

  it('marks the deadline passed when nothing was notified', () => {
    expect(milestone(tl({ receivedAt: at('2026-10-01') }), 'unfeasibility-notice-due').status).toBe('passed');
  });
});

describe("customer's extension (Art. 25(5))", () => {
  it('extends once to the chosen day, without a statutory maximum', () => {
    const t = tl({ receivedAt: at('2026-10-30'), events: [{ type: 'customer-extension', at: at('2026-11-02'), newTransitionEnd: '2028-06-30' }] });
    expect(t.transition).toMatchObject({ lastDay: '2028-06-30', extendedBy: ['customer'] });
  });

  it('stacks on the alternative period of Art. 25(4)', () => {
    const t = tl({
      receivedAt: at('2026-10-30'),
      events: [
        { type: 'unfeasibility-notified', at: at('2026-11-02'), reasons: 'r', alternativeTransitionEnd: '2027-04-30' },
        { type: 'customer-extension', at: at('2026-11-03'), newTransitionEnd: '2027-06-30' },
      ],
    });
    expect(t.transition).toMatchObject({ lastDay: '2027-06-30', extendedBy: ['provider-unfeasibility', 'customer'] });
  });

  it('flags an extension recorded after the transitional period or not longer', () => {
    const late = tl({ receivedAt: at('2026-08-01'), events: [{ type: 'customer-extension', at: '2026-11-01T10:00:00.000Z', newTransitionEnd: '2027-01-31' }] });
    expect(codes(late)).toContain('extension-after-transition');
    // Art. 25(5), recital 87: an ended period is not extended. The deadline stays; retrieval starts after the named end.
    expect(late.transition).toMatchObject({ lastDay: '2026-10-31', disregardedLastDay: '2027-01-31', extendedBy: [] });
    expect(late.retrieval).toMatchObject({ firstDay: '2027-02-01', lastDay: '2027-03-02' });
    expect(milestone(late, 'transition-end').status).toBe('late');
    const short = tl({ receivedAt: at('2026-10-30'), events: [{ type: 'customer-extension', at: at('2026-11-02'), newTransitionEnd: '2027-01-29' }] });
    expect(codes(short)).toContain('extension-not-longer');
    expect(short.transition?.lastDay).toBe('2027-01-29');
  });
});

describe('retrieval period and erasure (Art. 25(2)(g) and (h))', () => {
  it('runs at least 30 calendar days after the transitional period, then erasure', () => {
    const t = tl({ receivedAt: at('2026-10-30') });
    expect(t.retrieval).toEqual({ firstDay: '2027-01-30', lastDay: '2027-02-28', days: 30 });
    expect(t.erasureFrom).toBe('2027-03-01');
    expect(milestone(t, 'erasure-from').at).toBe('2027-02-28T22:00:00.000Z');
  });

  it('uses a longer period from the contract or the request', () => {
    expect(tl({ receivedAt: at('2026-10-30') }, { 'contract.retrievalDays': 45 }).retrieval?.lastDay).toBe('2027-03-15');
    expect(tl({ receivedAt: at('2026-10-30'), retrievalDays: 60 }).retrieval?.lastDay).toBe('2027-03-30');
  });

  it('raises a shorter period to 30 days and flags it', () => {
    const t = tl({ receivedAt: at('2026-10-30') }, { 'contract.retrievalDays': 29 });
    expect(t.retrieval?.days).toBe(30);
    expect(codes(t)).toContain('retrieval-too-short');
    expect(codes(tl({ receivedAt: at('2026-10-30') }, { 'contract.retrievalDays': undefined }))).toContain('retrieval-not-stated');
  });

  it('keeps the retrieval period after the agreed end even when switching completes early', () => {
    const t = tl({ receivedAt: at('2026-09-01'), events: [{ type: 'switching-completed', at: '2026-11-05T10:00:00.000Z' }] });
    expect(t.transition?.lastDay).toBe('2026-12-01');
    expect(t.retrieval?.firstDay).toBe('2026-12-02');
    expect(t.state).toBe('completed');
  });

  it('honours a later agreed erasure date and ignores an earlier one', () => {
    expect(tl({ receivedAt: at('2026-10-30'), erasureNotBefore: '2027-06-01' }).erasureFrom).toBe('2027-06-01');
    const t = tl({ receivedAt: at('2026-10-30'), erasureNotBefore: '2027-02-28' });
    expect(t.erasureFrom).toBe('2027-03-01');
    expect(codes(t)).toContain('erasure-date-too-early');
  });

  it('flags erasure confirmed before the retrieval period ended, or without completion', () => {
    const t = tl({
      receivedAt: at('2026-08-01'),
      events: [
        { type: 'switching-completed', at: '2026-10-05T10:00:00.000Z' },
        { type: 'erasure-confirmed', at: '2026-10-06T10:00:00.000Z' },
      ],
    });
    expect(codes(t)).toContain('erased-before-retrieval-end');
    expect(t.state).toBe('erased');
    const noSwitch = tl({ receivedAt: at('2026-08-01'), events: [{ type: 'erasure-confirmed', at: '2026-11-06T10:00:00.000Z' }] });
    expect(codes(noSwitch)).toContain('erased-without-completion');
  });
});

describe('erase-only requests (Art. 25(2)(c)(ii), 25(3)(c))', () => {
  it('ends the contract with the notice period and has no transition or retrieval', () => {
    const t = tl({ receivedAt: at('2026-10-30'), target: { kind: 'erase' }, data: { categoryIds: [], assetIds: [] } });
    expect(t.transition).toBeUndefined();
    expect(t.retrieval).toBeUndefined();
    expect(t.unfeasibilityNoticeDue).toBeUndefined();
    expect(milestone(t, 'termination')).toMatchObject({ date: '2026-12-30', status: 'upcoming' });
    expect(t.erasureFrom).toBe('2026-12-31');
    expect(t.state).toBe('notice');
    expect(tl({ receivedAt: at('2026-08-01'), target: { kind: 'erase' } }).state).toBe('terminated');
  });
});

describe('states and statuses', () => {
  const base = { receivedAt: at('2026-10-30') };
  const stateAt = (now: string, events: unknown[] = []): string => tl({ ...base, events }, {}, ms(now)).state;

  it('moves through notice, transition and overdue', () => {
    expect(stateAt('2026-11-01T00:00:00Z')).toBe('notice');
    expect(stateAt('2026-12-30T21:59:59.999Z')).toBe('notice');
    expect(stateAt('2026-12-30T22:00:00.000Z')).toBe('transition');
    expect(stateAt('2027-01-29T21:59:59.999Z')).toBe('transition');
    expect(stateAt('2027-01-29T22:00:00.000Z')).toBe('overdue');
  });

  it('moves through completed, retrieval, erasure-due and erased', () => {
    const done = [{ type: 'switching-completed', at: '2027-01-10T10:00:00.000Z' }];
    expect(stateAt('2027-01-20T00:00:00Z', done)).toBe('completed');
    expect(stateAt('2027-02-01T00:00:00Z', done)).toBe('retrieval');
    expect(stateAt('2027-03-01T00:00:00Z', done)).toBe('erasure-due');
    expect(stateAt('2027-03-02T00:00:00Z', [...done, { type: 'erasure-confirmed', at: '2027-03-01T10:00:00.000Z' }])).toBe('erased');
  });

  it('marks a missed transitional period and a late completion', () => {
    const overdue = tl(base, {}, ms('2027-02-01T00:00:00Z'));
    expect(milestone(overdue, 'transition-end').status).toBe('late');
    expect(codes(overdue)).toContain('transition-overdue');
    const late = tl({ ...base, events: [{ type: 'switching-completed', at: '2027-01-30T10:00:00.000Z' }] }, {}, ms('2027-02-01T00:00:00Z'));
    expect(milestone(late, 'transition-end').status).toBe('late');
    expect(codes(late)).toContain('completed-late');
    expect(milestone(late, 'switching-completed').status).toBe('done');
  });

  it('shows erasure as due once its day starts', () => {
    const done = [{ type: 'switching-completed', at: '2027-01-10T10:00:00.000Z' }];
    expect(milestone(tl({ ...base, events: done }, {}, ms('2027-02-28T21:59:59.999Z')), 'erasure-from').status).toBe('upcoming');
    expect(milestone(tl({ ...base, events: done }, {}, ms('2027-02-28T22:00:00.000Z')), 'erasure-from').status).toBe('due');
  });

  it('cancels open milestones when the request is withdrawn', () => {
    const t = tl({ ...base, events: [{ type: 'cancelled', at: '2026-11-02T10:00:00.000Z' }] }, {}, ms('2027-06-01T00:00:00Z'));
    expect(t.state).toBe('cancelled');
    expect(milestone(t, 'transition-end').status).toBe('cancelled');
    expect(milestone(t, 'erasure-from').status).toBe('cancelled');
    expect(milestone(t, 'notice-end').status).toBe('passed');
    expect(codes(t)).not.toContain('transition-overdue');
  });

  it('sorts milestones by time', () => {
    const t = tl(base);
    const times = t.milestones.map((m) => Date.parse(m.at));
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });
});

describe('dates around the Regulation', () => {
  it('shows the 12 January 2027 switching-charge cut-over when the process spans it', () => {
    const t = tl({ receivedAt: at('2026-10-30') });
    expect(milestone(t, 'charges-free-from')).toMatchObject({ date: '2027-01-12', at: '2027-01-11T22:00:00.000Z' });
    expect(tl({ receivedAt: at('2027-01-12') }, {}, ms('2027-02-01T00:00:00Z')).milestones.some((m) => m.id === 'charges-free-from')).toBe(false);
    expect(tl({ receivedAt: at('2025-10-01') }, {}, ms('2025-10-02T00:00:00Z')).milestones.some((m) => m.id === 'charges-free-from')).toBe(false);
  });

  it('notes requests made before the Regulation applied (12 September 2025)', () => {
    expect(codes(tl({ receivedAt: at('2025-09-11') }, {}, ms('2025-09-12T00:00:00Z')))).toContain('before-application');
    expect(codes(tl({ receivedAt: at('2025-09-12') }, {}, ms('2025-09-13T00:00:00Z')))).not.toContain('before-application');
  });

  it('notes the specific regimes of Art. 31', () => {
    expect(codes(tl({}, { 'services.1.regime': 'custom-built', 'services.1.offeredAtBroadCommercialScale': false }))).toContain('regime-custom-built');
    expect(codes(tl({}, { 'services.1.regime': 'custom-built', 'services.1.offeredAtBroadCommercialScale': true }))).not.toContain('regime-custom-built');
    expect(codes(tl({}, { 'services.1.regime': 'non-production', 'services.1.limitedPeriodDays': 30 }))).toContain('regime-non-production');
  });

  it('works out dates for the latest request year the validator allows', () => {
    const t = tl({ receivedAt: '2999-12-31T12:00:00.000Z', events: [{ type: 'customer-extension', at: '2999-12-31T13:00:00.000Z', newTransitionEnd: '2999-12-31' }] }, {}, ms('2999-12-31T14:00:00Z'));
    expect(t.notice.lastDay).toBe('3000-02-28');
    expect(t.erasureFrom).toBe('3000-04-30');
  });

  it('gives the last day the contract applies (Art. 25(2)(a), (c))', () => {
    // Notice ends 30 December 2026, transitional period ends 29 January 2027.
    expect(contractLastDay(tl({ receivedAt: at('2026-10-30') }))).toBe('2027-01-29');
    expect(contractLastDay(tl({ receivedAt: at('2026-10-30'), events: [{ type: 'switching-completed', at: '2027-01-05T10:00:00.000Z' }] }, {}, ms('2027-01-06T00:00:00Z')))).toBe('2027-01-05');
    expect(contractLastDay(tl({ receivedAt: at('2026-10-30'), events: [{ type: 'switching-completed', at: '2027-02-05T10:00:00.000Z' }] }, {}, ms('2027-02-06T00:00:00Z')))).toBe('2027-01-29');
    expect(contractLastDay(tl({ receivedAt: at('2026-10-30'), target: { kind: 'erase' }, data: { categoryIds: [], assetIds: [] } }))).toBe('2026-12-30');
  });

  it('is pure: the same inputs give the same output', () => {
    expect(tl({ receivedAt: at('2026-10-30') })).toEqual(tl({ receivedAt: at('2026-10-30') }));
  });
});
