// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

import { addDays, addMonthsClamped, weekday, type LocalDate } from '../time/zone.ts';

/**
 * Period arithmetic on calendar dates. The counting rule, applied to every period (documented in LEGAL.md):
 *
 * - A period that runs from an event does not count the day of the event. It starts on the next day and ends
 *   at the end of its last day in the profile's time zone.
 * - "N calendar days": the last day is the event day plus N.
 * - "N months": the last day has the same day of the month as the event day, N months later; if that month is
 *   shorter, its last day.
 * - "N working days": the Nth day after the event day that is neither a Saturday, a Sunday, nor a listed public
 *   holiday.
 */

/** Last day of a period of `n` calendar days running from `eventDay`. */
export function lastDayOfDays(eventDay: LocalDate, n: number): LocalDate {
  return addDays(eventDay, n);
}

/** Last day of a period of `n` months running from `eventDay`. */
export function lastDayOfMonths(eventDay: LocalDate, n: number): LocalDate {
  return addMonthsClamped(eventDay, n);
}

/** True for Monday to Friday dates that are not in `holidays`. */
export function isWorkingDay(day: LocalDate, holidays: ReadonlySet<LocalDate>): boolean {
  const w = weekday(day);
  return w !== 0 && w !== 6 && !holidays.has(day);
}

/** Last day of a period of `n` working days running from `eventDay` (n >= 1). */
export function lastDayOfWorkingDays(eventDay: LocalDate, n: number, holidays: ReadonlySet<LocalDate>): LocalDate {
  if (!Number.isSafeInteger(n) || n < 1 || n > 3650) throw new RangeError('Working day count out of range.');
  let day = eventDay;
  let counted = 0;
  // Bounded: every week has at least one working day unless a whole year is listed as holidays; cap the scan.
  for (let guard = 0; counted < n; guard++) {
    if (guard > n * 7 + 3660) throw new RangeError('Too many consecutive non-working days.');
    day = addDays(day, 1);
    if (isWorkingDay(day, holidays)) counted++;
  }
  return day;
}

/** The later of two dates. */
export function maxDate(a: LocalDate, b: LocalDate): LocalDate {
  return a > b ? a : b;
}

/** The earlier of two dates. */
export function minDate(a: LocalDate, b: LocalDate): LocalDate {
  return a < b ? a : b;
}
