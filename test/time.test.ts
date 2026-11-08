// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { lastDayOfDays, lastDayOfMonths, lastDayOfWorkingDays, isWorkingDay, maxDate, minDate } from '../src/engine/periods.ts';
import {
  addDays,
  addMonthsClamped,
  dateIn,
  daysBetween,
  daysInMonth,
  endOfDay,
  formatLocal,
  isIsoInstant,
  isLocalDate,
  isValidTimeZone,
  localDate,
  offsetAt,
  parseInstant,
  startOfDay,
  toIso,
  toMs,
  weekday,
} from '../src/time/zone.ts';
import { ms } from './helpers.ts';

describe('calendar dates', () => {
  it('validates real dates only', () => {
    expect(isLocalDate('2028-02-29')).toBe(true);
    expect(isLocalDate('2027-02-29')).toBe(false);
    expect(isLocalDate('2026-04-31')).toBe(false);
    expect(isLocalDate('2026-13-01')).toBe(false);
    expect(isLocalDate('1969-12-31')).toBe(false);
    expect(isLocalDate('2026-1-01')).toBe(false);
    expect(() => localDate('2026-02-30')).toThrow(/not a calendar date/);
    expect(localDate('2026-02-28')).toBe('2026-02-28');
  });

  it('adds days across month and year ends and leap days', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2027-02-28', 1)).toBe('2027-03-01');
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31');
    expect(addDays('2026-03-28', 2)).toBe('2026-03-30'); // across the DST change; dates are zone-free
    expect(daysBetween('2026-12-31', '2027-03-01')).toBe(60);
    expect(() => addDays('nope', 1)).toThrow();
  });

  it('adds months keeping the day, or the last day of a shorter month', () => {
    expect(addMonthsClamped('2026-12-31', 2)).toBe('2027-02-28');
    expect(addMonthsClamped('2027-12-31', 2)).toBe('2028-02-29');
    expect(addMonthsClamped('2026-08-31', 1)).toBe('2026-09-30');
    expect(addMonthsClamped('2026-01-31', 2)).toBe('2026-03-31');
    expect(addMonthsClamped('2026-03-31', 2)).toBe('2026-05-31');
    expect(addMonthsClamped('2026-04-30', 2)).toBe('2026-06-30');
    expect(addMonthsClamped('2026-07-31', 7)).toBe('2027-02-28');
    expect(addMonthsClamped('2027-07-31', 7)).toBe('2028-02-29');
    expect(addMonthsClamped('2026-11-15', 2)).toBe('2027-01-15');
    expect(addMonthsClamped('2026-03-15', -3)).toBe('2025-12-15');
  });

  it('knows weekdays and month lengths', () => {
    expect(weekday('2026-11-08')).toBe(0); // Sunday
    expect(weekday('2026-10-30')).toBe(5); // Friday
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2100, 2)).toBe(28);
  });
});

describe('time zones and day boundaries', () => {
  it('accepts IANA zones and rejects others', () => {
    expect(isValidTimeZone('Europe/Vilnius')).toBe(true);
    expect(isValidTimeZone('UTC')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
    expect(isValidTimeZone('../etc')).toBe(false);
    expect(isValidTimeZone('a'.repeat(65))).toBe(false);
  });

  it('finds day boundaries in Vilnius on both DST change days', () => {
    // 29 March 2026: clocks go from 03:00 to 04:00 (UTC+2 to UTC+3). The day lasts 23 hours.
    expect(toIso(startOfDay('2026-03-29', 'Europe/Vilnius'))).toBe('2026-03-28T22:00:00.000Z');
    expect(toIso(endOfDay('2026-03-29', 'Europe/Vilnius'))).toBe('2026-03-29T21:00:00.000Z');
    // 25 October 2026: clocks go from 04:00 back to 03:00. The day lasts 25 hours.
    expect(toIso(startOfDay('2026-10-25', 'Europe/Vilnius'))).toBe('2026-10-24T21:00:00.000Z');
    expect(toIso(endOfDay('2026-10-25', 'Europe/Vilnius'))).toBe('2026-10-25T22:00:00.000Z');
    expect(offsetAt(ms('2026-07-01T00:00:00Z'), 'Europe/Vilnius')).toBe(3 * 3_600_000);
  });

  it('handles a zone whose clocks skip midnight (Santiago, 6 September 2026)', () => {
    // 00:00 does not exist; the day starts at 01:00 local, 04:00 UTC.
    expect(toIso(startOfDay('2026-09-06', 'America/Santiago'))).toBe('2026-09-06T04:00:00.000Z');
    expect(toIso(startOfDay('2026-04-05', 'America/Santiago'))).toBe('2026-04-05T04:00:00.000Z');
  });

  it('gives the first instant of every day of 2026 in several zones', () => {
    for (const zone of ['Europe/Vilnius', 'Europe/Dublin', 'Europe/Lisbon', 'Atlantic/Azores', 'America/Santiago', 'Australia/Lord_Howe', 'Pacific/Chatham', 'UTC']) {
      for (let d = '2026-01-01'; d <= '2026-12-31'; d = addDays(d, 1)) {
        const s = startOfDay(d, zone);
        expect(dateIn(s, zone), `${zone} ${d}`).toBe(d);
        expect(dateIn(s - 1, zone) < d, `${zone} ${d}`).toBe(true);
      }
    }
  });

  it('formats local times with their offset', () => {
    expect(formatLocal('2026-03-29T00:30:00.000Z', 'Europe/Vilnius')).toBe('2026-03-29 02:30 (Europe/Vilnius, UTC+02:00)');
    expect(formatLocal('2026-03-29T01:30:00.000Z', 'Europe/Vilnius')).toBe('2026-03-29 04:30 (Europe/Vilnius, UTC+03:00)');
    expect(formatLocal('2026-06-01T12:00:00.000Z', 'America/St_Johns')).toBe('2026-06-01 09:30 (America/St_Johns, UTC-02:30)');
  });
});

describe('instants', () => {
  it('accepts only the canonical stored form', () => {
    expect(isIsoInstant('2026-03-01T09:00:00.000Z')).toBe(true);
    expect(isIsoInstant('2026-03-01T09:00:00Z')).toBe(false);
    expect(isIsoInstant('2026-02-30T09:00:00.000Z')).toBe(false);
    expect(() => toMs('2026-03-01')).toThrow(/stored UTC timestamp/);
    expect(() => toIso(Number.NaN)).toThrow(/range/);
    expect(() => toIso(Date.UTC(1969, 0, 1))).toThrow(/range/);
  });

  it('parses dates, wall-clock times and offsets', () => {
    expect(parseInstant('2026-03-01', 'Europe/Vilnius')).toBe('2026-02-28T22:00:00.000Z');
    expect(parseInstant('2026-03-01T09:30', 'Europe/Vilnius')).toBe('2026-03-01T07:30:00.000Z');
    expect(parseInstant('2026-03-01 09:30:15.5', 'Europe/Vilnius')).toBe('2026-03-01T07:30:15.500Z');
    expect(parseInstant('2026-03-01T09:30+01:00', 'Europe/Vilnius')).toBe('2026-03-01T08:30:00.000Z');
    expect(parseInstant('2026-03-01T09:30-03:30', 'UTC')).toBe('2026-03-01T13:00:00.000Z');
    expect(parseInstant('2026-03-01T09:30Z', 'Europe/Vilnius')).toBe('2026-03-01T09:30:00.000Z');
    expect(parseInstant('  2026-03-29T04:30  ', 'Europe/Vilnius')).toBe('2026-03-29T01:30:00.000Z');
  });

  it('refuses wall-clock times in a DST gap or overlap', () => {
    expect(() => parseInstant('2026-03-29T03:30', 'Europe/Vilnius')).toThrow(/does not exist/);
    expect(() => parseInstant('2026-10-25T03:30', 'Europe/Vilnius')).toThrow(/happens twice/);
    expect(parseInstant('2026-10-25T03:30+03:00', 'Europe/Vilnius')).toBe('2026-10-25T00:30:00.000Z');
    expect(parseInstant('2026-10-25T03:30+02:00', 'Europe/Vilnius')).toBe('2026-10-25T01:30:00.000Z');
  });

  it('rejects malformed input', () => {
    for (const bad of ['', 'tomorrow', '2026-02-30', '2026-03-01T24:00', '2026-03-01T09:60', '2026-03-01T09:30+19:00', '2026-03-01T09:30+01:60', '2026-03-01T09']) {
      expect(() => parseInstant(bad, 'UTC'), bad).toThrow();
    }
  });
});

describe('periods', () => {
  const none = new Set<string>();

  it('counts calendar days from the day after the event', () => {
    expect(lastDayOfDays('2026-12-30', 30)).toBe('2027-01-29');
    expect(lastDayOfDays('2027-01-31', 30)).toBe('2027-03-02');
    expect(lastDayOfDays('2028-01-31', 30)).toBe('2028-03-01');
  });

  it('counts months to the same day or the month end', () => {
    expect(lastDayOfMonths('2026-12-31', 2)).toBe('2027-02-28');
    expect(lastDayOfMonths('2026-10-30', 2)).toBe('2026-12-30');
  });

  it('counts working days, skipping weekends and listed holidays', () => {
    // Request on Friday 30 October 2026: 14 working days end on Thursday 19 November.
    expect(lastDayOfWorkingDays('2026-10-30', 14, none)).toBe('2026-11-19');
    // On a Saturday: counting starts on Monday.
    expect(lastDayOfWorkingDays('2026-10-31', 1, none)).toBe('2026-11-02');
    expect(lastDayOfWorkingDays('2026-11-01', 14, none)).toBe('2026-11-19');
    // Holidays push the date: 1 and 2 November listed.
    expect(lastDayOfWorkingDays('2026-10-30', 14, new Set(['2026-11-02', '2026-11-03']))).toBe('2026-11-23');
    // Across Christmas and New Year with holidays.
    const lt = new Set(['2026-12-24', '2026-12-25', '2026-12-26', '2027-01-01']);
    expect(lastDayOfWorkingDays('2026-12-18', 14, lt)).toBe('2027-01-12');
    expect(lastDayOfWorkingDays('2026-12-18', 14, none)).toBe('2027-01-07');
    // A holiday on a weekend changes nothing.
    expect(lastDayOfWorkingDays('2026-10-30', 14, new Set(['2026-11-07']))).toBe('2026-11-19');
  });

  it('identifies working days and refuses bad counts', () => {
    expect(isWorkingDay('2026-11-09', none)).toBe(true);
    expect(isWorkingDay('2026-11-08', none)).toBe(false);
    expect(isWorkingDay('2026-11-09', new Set(['2026-11-09']))).toBe(false);
    expect(() => lastDayOfWorkingDays('2026-11-09', 0, none)).toThrow(RangeError);
    expect(() => lastDayOfWorkingDays('2026-11-09', 1.5, none)).toThrow(RangeError);
  });

  it('stops on an impossible calendar instead of looping', () => {
    const all = new Set<string>();
    for (let d = '2026-11-10'; d < '2037-01-01'; d = addDays(d, 1)) all.add(d);
    expect(() => lastDayOfWorkingDays('2026-11-09', 1, all)).toThrow(/non-working/);
  });

  it('compares dates', () => {
    expect(maxDate('2026-01-02', '2026-01-01')).toBe('2026-01-02');
    expect(minDate('2026-01-02', '2026-01-01')).toBe('2026-01-01');
  });
});
