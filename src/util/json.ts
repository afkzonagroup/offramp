// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

import { createHash } from 'node:crypto';
import { invalid } from './errors.ts';

/** Largest JSON document Offramp reads (1 MiB). */
export const MAX_JSON_BYTES = 1024 * 1024;
/** Deepest nesting accepted in a JSON document. */
export const MAX_JSON_DEPTH = 32;

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Parses untrusted JSON text: size limit, nesting limit, and no keys that could pollute prototypes.
 * The result contains only plain objects, arrays, strings, finite numbers, booleans and null.
 */
export function parseJson(text: string, what = 'JSON'): unknown {
  if (Buffer.byteLength(text, 'utf8') > MAX_JSON_BYTES) invalid(`${what} is larger than ${MAX_JSON_BYTES} bytes.`);
  // Checked on the text first: JSON.parse with a reviver recurses once per level, so a deeply nested document
  // within the size limit would otherwise overflow the stack before the depth check below could run.
  checkTextDepth(text, what);
  let value: unknown;
  try {
    value = JSON.parse(text, (key, v: unknown) => {
      if (FORBIDDEN_KEYS.has(key)) invalid(`${what} contains the forbidden key "${key}".`);
      return v;
    });
  } catch (err) {
    if (err instanceof SyntaxError) invalid(`${what} is not valid JSON.`);
    throw err;
  }
  checkDepth(value, 0, what);
  return value;
}

/** Linear scan of the nesting depth of JSON text; brackets inside strings are ignored. */
function checkTextDepth(text: string, what: string): void {
  let depth = 0;
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (inString) {
      if (c === 0x5c) i++; // backslash: skip the escaped character
      else if (c === 0x22) inString = false;
    } else if (c === 0x22) inString = true;
    else if (c === 0x5b || c === 0x7b) {
      if (++depth > MAX_JSON_DEPTH + 1) invalid(`${what} is nested more than ${MAX_JSON_DEPTH} levels deep.`);
    } else if (c === 0x5d || c === 0x7d) depth--;
  }
}

function checkDepth(v: unknown, depth: number, what: string): void {
  if (depth > MAX_JSON_DEPTH) invalid(`${what} is nested more than ${MAX_JSON_DEPTH} levels deep.`);
  if (Array.isArray(v)) for (const x of v) checkDepth(x, depth + 1, what);
  else if (v !== null && typeof v === 'object') for (const x of Object.values(v)) checkDepth(x, depth + 1, what);
}

/** JSON with object keys sorted, no whitespace. Used for digests, so equal data gives equal bytes. */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v === 'boolean' || typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) invalid('Numbers must be finite.');
    return JSON.stringify(v);
  }
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  if (typeof v === 'object') {
    const entries = Object.entries(v as Record<string, unknown>)
      .filter(([, x]) => x !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, x]) => `${JSON.stringify(k)}:${canonicalJson(x)}`).join(',')}}`;
  }
  return invalid('Value cannot be represented as JSON.');
}

/** Lower-case hex SHA-256 of the canonical JSON of `v`. */
export function digest(v: unknown): string {
  return createHash('sha256').update(canonicalJson(v), 'utf8').digest('hex');
}
