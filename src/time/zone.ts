// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

import { invalid } from '../util/errors.ts';

/**
 * Time handling without a bundled time-zone database: wall-clock views come from the built-in Intl API.
 *
 * - Instants are stored as canonical UTC ISO strings ("2026-01-31T09:00:00.000Z").
 * - Calendar dates are "YYYY-MM-DD" strings ({@link LocalDate}) in the time zone of the provider profile.
 * - Day boundaries are found by searching the real offsets in force, so periods are correct across DST changes,
 *   including zones whose clocks change at midnight.
 */

/** A calendar date, "YYYY-MM-DD". */
export type LocalDate = string;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/u;
const MIN_MS = Date.UTC(1970, 0, 1);
const MAX_MS = Date.UTC(9999, 11, 31, 23, 59, 59, 999);
const DAY_MS = 86_400_000;

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(zone: string): Intl.DateTimeFormat {
  let f = formatters.get(zone);
  if (f === undefined) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      era: 'short',
    });
    if (formatters.size > 100) formatters.clear();
    formatters.set(zone, f);
  }
  return f;
}

/** True when `zone` is an IANA zone name the runtime knows (e.g. "Europe/Vilnius", "UTC"). */
export function isValidTimeZone(zone: string): boolean {
  if (zone.length === 0 || zone.length > 64 || !/^[A-Za-z][A-Za-z0-9_+\-/]*$/u.test(zone)) return false;
  try {
    formatter(zone);
    return true;
  } catch {
    return false;
  }
}

interface WallClock {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

function wallClock(ms: number, zone: string): WallClock {
  const parts = formatter(zone).formatToParts(new Date(ms));
  const get = (type: Intl.DateTimeFormatPartTypes): number => {
    const p = parts.find((x) => x.type === type);
    /* v8 ignore next -- Intl always returns these parts for the options above */
    if (p === undefined) throw new Error(`Intl did not return ${type}`);
    return Number(p.value);
  };
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute'), second: get('second') };
}

/** UTC offset of `zone` at instant `ms`, in milliseconds (local = utc + offset). */
export function offsetAt(ms: number, zone: string): number {
  const w = wallClock(ms, zone);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second, ((ms % 1000) + 1000) % 1000);
  return asUtc - ms;
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0');
}

function fromParts(y: number, m: number, d: number): LocalDate {
  return `${pad(y, 4)}-${pad(m)}-${pad(d)}`;
}

/** True when `s` is a real calendar date "YYYY-MM-DD" between 1970 and 9999. */
export function isLocalDate(s: string): boolean {
  const m = DATE_RE.exec(s);
  if (m === null) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  return y >= 1970 && mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonth(y, mo);
}

/** Validates a calendar date. */
export function localDate(s: string, what = 'Date'): LocalDate {
  if (!isLocalDate(s)) invalid(`${what} "${s.slice(0, 20)}" is not a calendar date (YYYY-MM-DD).`);
  return s;
}

function split(date: LocalDate): [number, number, number] {
  const m = DATE_RE.exec(date);
  if (m === null) return invalid(`"${date.slice(0, 20)}" is not a calendar date (YYYY-MM-DD).`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** `date` plus `n` calendar days (n may be negative). */
export function addDays(date: LocalDate, n: number): LocalDate {
  const [y, m, d] = split(date);
  const t = new Date(Date.UTC(y, m - 1, d) + n * DAY_MS);
  return fromParts(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/**
 * The date `n` months after `date`, keeping the day of the month; when the target month is shorter,
 * the last day of that month (31 December + 2 months = 28 or 29 February).
 */
export function addMonthsClamped(date: LocalDate, n: number): LocalDate {
  const [y, m, d] = split(date);
  const index = y * 12 + (m - 1) + n;
  const ty = Math.floor(index / 12);
  const tm = (index % 12) + 1;
  return fromParts(ty, tm, Math.min(d, daysInMonth(ty, tm)));
}

/** Day of the week: 0 = Sunday … 6 = Saturday. */
export function weekday(date: LocalDate): number {
  const [y, m, d] = split(date);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Number of calendar days from `a` to `b` (positive when b is later). */
export function daysBetween(a: LocalDate, b: LocalDate): number {
  const [y1, m1, d1] = split(a);
  const [y2, m2, d2] = split(b);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / DAY_MS);
}

/** The calendar date of instant `ms` in `zone`. */
export function dateIn(ms: number, zone: string): LocalDate {
  const w = wallClock(ms, zone);
  return fromParts(w.year, w.month, w.day);
}

/**
 * The first instant of calendar day `date` in `zone`. Normally local midnight; when midnight does not exist
 * (a DST gap at 00:00) the first instant that falls on that date. Found by binary search over the real
 * offsets, so no assumption about the size or time of a DST change is made.
 */
export function startOfDay(date: LocalDate, zone: string): number {
  const [y, m, d] = split(date);
  const naive = Date.UTC(y, m - 1, d);
  // Real offsets are within ±18 h; search a window that certainly contains the boundary.
  let lo = naive - 20 * 3_600_000;
  let hi = naive + 20 * 3_600_000;
  // Invariant: dateIn(lo) < date <= dateIn(hi).
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (dateIn(mid, zone) < date) lo = mid;
    else hi = mid;
  }
  return hi;
}

/** The instant at which calendar day `date` ends in `zone` (exclusive), i.e. the start of the next day. */
export function endOfDay(date: LocalDate, zone: string): number {
  return startOfDay(addDays(date, 1), zone);
}

/** ISO string for a UTC instant in ms. */
export function toIso(ms: number): string {
  if (!Number.isFinite(ms) || ms < MIN_MS || ms > MAX_MS) invalid('Date is out of the supported range (1970–9999).');
  return new Date(ms).toISOString();
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

/** True when `s` is a canonical stored UTC timestamp. */
export function isIsoInstant(s: string): boolean {
  if (!ISO_RE.test(s)) return false;
  const v = Date.parse(s);
  return !Number.isNaN(v) && v >= MIN_MS && v <= MAX_MS && new Date(v).toISOString() === s;
}

/** Milliseconds for a stored ISO instant. Only accepts the canonical UTC form produced by {@link toIso}. */
export function toMs(iso: string): number {
  if (!isIsoInstant(iso)) invalid(`"${iso.slice(0, 40)}" is not a stored UTC timestamp (e.g. 2026-03-01T09:00:00.000Z).`);
  return Date.parse(iso);
}

const INPUT_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})?)?$/u;

/**
 * Parses user input into a stored UTC ISO string.
 *
 * Accepts `YYYY-MM-DD` (start of that day in `zone`), or `YYYY-MM-DDTHH:mm[:ss[.fff]]` optionally followed by
 * `Z` or `±HH:MM`. Without an offset the value is wall-clock time in `zone`; a wall-clock time that does not
 * exist or exists twice because of a DST change is rejected, because guessing could move a statutory date.
 *
 * @example parseInstant('2026-03-29T03:30', 'Europe/Vilnius') // '2026-03-29T00:30:00.000Z'
 */
export function parseInstant(input: string, zone: string): string {
  const s = input.trim();
  const m = INPUT_RE.exec(s);
  if (m === null) return invalid(`"${s.slice(0, 40)}" is not a date or date-time. Use e.g. 2026-03-29 or 2026-03-29T14:05 or 2026-03-29T14:05:00+02:00.`);
  const [, y, mo, d, h, mi, sec, frac, off] = m;
  const date = `${y ?? ''}-${mo ?? ''}-${d ?? ''}`;
  localDate(date);
  if (h === undefined) return toIso(startOfDay(date, zone));
  const hour = Number(h);
  const minute = Number(mi);
  const second = sec === undefined ? 0 : Number(sec);
  const ms = frac === undefined ? 0 : Number(frac.padEnd(3, '0'));
  if (hour > 23 || minute > 59 || second > 59) invalid(`"${s.slice(0, 40)}" has an invalid time of day.`);
  const naive = Date.UTC(Number(y), Number(mo) - 1, Number(d), hour, minute, second, ms);
  if (off !== undefined) {
    if (off === 'Z') return toIso(naive);
    const sign = off.startsWith('-') ? -1 : 1;
    const oh = Number(off.slice(1, 3));
    const om = Number(off.slice(4, 6));
    if (oh > 18 || om > 59) invalid(`"${s.slice(0, 40)}" has an invalid UTC offset.`);
    return toIso(naive - sign * (oh * 60 + om) * 60_000);
  }
  const offsets = new Set([offsetAt(naive - DAY_MS, zone), offsetAt(naive, zone), offsetAt(naive + DAY_MS, zone)]);
  const matches = new Set<number>();
  for (const o of offsets) {
    const candidate = naive - o;
    if (offsetAt(candidate, zone) === o) matches.add(candidate);
  }
  if (matches.size === 0) invalid(`${s.slice(0, 40)} does not exist in ${zone} (clocks change). Add an explicit UTC offset, e.g. ${s.slice(0, 16)}+02:00.`);
  if (matches.size > 1) invalid(`${s.slice(0, 40)} happens twice in ${zone} (clocks change). Add an explicit UTC offset, e.g. ${s.slice(0, 16)}+02:00.`);
  return toIso([...matches][0] as number);
}

/** A human-readable local date-time, e.g. "2026-03-29 14:05 (Europe/Vilnius, UTC+03:00)". */
export function formatLocal(iso: string, zone: string): string {
  const ms = toMs(iso);
  const w = wallClock(ms, zone);
  const off = offsetAt(ms, zone) / 60_000;
  const sign = off < 0 ? '-' : '+';
  const a = Math.abs(off);
  return `${fromParts(w.year, w.month, w.day)} ${pad(w.hour)}:${pad(w.minute)} (${zone}, UTC${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)})`;
}
