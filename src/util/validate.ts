// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

import { invalid } from './errors.ts';

/**
 * Hand-written boundary validation. Every reader checks type, length and allowed values and reports
 * the JSON path of the offending value. Unknown object keys are rejected (allow-list).
 */

/** C0/C1 controls (except tab and line feed), bidirectional overrides and isolates, zero-width characters, BOM, line/paragraph separators. */
// eslint-disable-next-line no-control-regex -- detecting control characters is the purpose of this pattern
const UNSAFE_CHARS = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u061c\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]/u;

export interface TextOptions {
  /** Maximum length in code points. */
  readonly max: number;
  /** Minimum length after trimming (default 1). */
  readonly min?: number;
  /** Allow line feeds (default false). */
  readonly multiline?: boolean;
  /** Pattern the whole value must match. */
  readonly pattern?: RegExp;
  /** Human description used in the error when the pattern does not match. */
  readonly patternHint?: string;
}

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v) as unknown;
  return proto === Object.prototype || proto === null;
}

/** A plain object whose keys are all in `allowed`. */
export function obj(v: unknown, path: string, allowed: readonly string[]): Record<string, unknown> {
  if (!isPlainObject(v)) invalid('must be an object.', path);
  for (const k of Object.keys(v)) {
    if (!allowed.includes(k)) invalid(`unknown property "${printable(k, 40)}".`, path);
  }
  return v;
}

/** A required string. Text is never altered except that "\r\n" is normalised to "\n". */
export function text(v: unknown, path: string, opts: TextOptions): string {
  if (typeof v !== 'string') invalid('must be a string.', path);
  const s = v.replace(/\r\n/gu, '\n');
  if (UNSAFE_CHARS.test(s)) invalid('contains control, invisible or bidirectional characters.', path);
  if (opts.multiline !== true && s.includes('\n')) invalid('must be a single line.', path);
  if (s.includes('\t') && opts.multiline !== true) invalid('must not contain tabs.', path);
  const len = codePoints(s).length;
  if (len > opts.max) invalid(`must be at most ${opts.max} characters.`, path);
  if (s.trim().length < (opts.min ?? 1)) invalid(opts.min === 0 ? 'is invalid.' : 'must not be empty.', path);
  if (opts.pattern !== undefined && !opts.pattern.test(s)) invalid(`must be ${opts.patternHint ?? 'in the expected format'}.`, path);
  return s;
}

export function optText(v: unknown, path: string, opts: TextOptions): string | undefined {
  return v === undefined ? undefined : text(v, path, opts);
}

export function bool(v: unknown, path: string): boolean {
  if (typeof v !== 'boolean') invalid('must be true or false.', path);
  return v;
}

export function optBool(v: unknown, path: string): boolean | undefined {
  return v === undefined ? undefined : bool(v, path);
}

/** An integer in [min, max]. */
export function int(v: unknown, path: string, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v)) invalid('must be a whole number.', path);
  if (v < min || v > max) invalid(`must be between ${min} and ${max}.`, path);
  return v;
}

export function optInt(v: unknown, path: string, min: number, max: number): number | undefined {
  return v === undefined ? undefined : int(v, path, min, max);
}

/** One of the listed string values. */
export function oneOf<const T extends string>(v: unknown, path: string, values: readonly T[]): T {
  if (typeof v !== 'string' || !(values as readonly string[]).includes(v)) invalid(`must be one of: ${values.join(', ')}.`, path);
  return v as T;
}

/** An array of at most `max` items, each read by `item`. */
export function list<T>(v: unknown, path: string, max: number, item: (x: unknown, p: string) => T): T[] {
  if (!Array.isArray(v)) invalid('must be an array.', path);
  if (v.length > max) invalid(`must have at most ${max} items.`, path);
  return v.map((x, i) => item(x, `${path}[${i}]`));
}

export function optList<T>(v: unknown, path: string, max: number, item: (x: unknown, p: string) => T): T[] | undefined {
  return v === undefined ? undefined : list(v, path, max, item);
}

/** The code points of `s` (JSON Schema `maxLength` counts code points too). */
export function codePoints(s: string): string[] {
  return Array.from(s);
}

/** Identifier pattern used for services, data categories, assets, charges and requests. */
export const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;

export function id(v: unknown, path: string): string {
  return text(v, path, { max: 64, pattern: ID_RE, patternHint: 'an identifier: letters, digits, ".", "_" or "-", starting with a letter or digit, at most 64 characters' });
}

/** Rejects duplicate identifiers in a list. */
export function unique(ids: readonly string[], path: string): void {
  const seen = new Set<string>();
  for (const [i, x] of ids.entries()) {
    if (seen.has(x)) invalid(`duplicate identifier "${x}".`, `${path}[${i}]`);
    seen.add(x);
  }
}

/** An absolute http(s) URL without credentials, at most 2048 characters. */
export function url(v: unknown, path: string): string {
  const s = text(v, path, { max: 2048 });
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return invalid('must be an absolute URL.', path);
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') invalid('must be an http or https URL.', path);
  if (u.username !== '' || u.password !== '') invalid('must not contain a user name or password.', path);
  if (u.hostname === '') invalid('must name a host.', path);
  return s;
}

export function optUrl(v: unknown, path: string): string | undefined {
  return v === undefined ? undefined : url(v, path);
}

const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,62}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,62}[A-Za-z0-9])?)+$/u;

export function email(v: unknown, path: string): string {
  return text(v, path, { max: 254, pattern: EMAIL_RE, patternHint: 'an e-mail address' });
}

export function optEmail(v: unknown, path: string): string | undefined {
  return v === undefined ? undefined : email(v, path);
}

/** Makes any text safe to print on a terminal or in a single-line message: control and invisible characters become \u{..}. */
export function printable(s: string, max = 200): string {
  const out = s.replace(
    // eslint-disable-next-line no-control-regex -- escaping control characters is the purpose of this pattern
    /[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]/gu,
    (c) => `\\u{${(c.codePointAt(0) ?? 0).toString(16)}}`,
  );
  const cps = codePoints(out);
  return cps.length > max ? `${cps.slice(0, max).join('')}…` : out;
}
