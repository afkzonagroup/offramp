// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

import type { ArticleRef } from '../legal/refs.ts';

/**
 * - conflict: what is stated contradicts a rule in the text (e.g. a three-month notice period).
 * - missing: information or a clause the text requires is not stated.
 * - review: a person must judge it (e.g. whether a charge is limited to directly linked costs).
 * - info: context, nothing to fix.
 */
export const SEVERITIES = ['conflict', 'missing', 'review', 'info'] as const;
export type Severity = (typeof SEVERITIES)[number];

export interface Finding {
  /** Stable rule code, e.g. "notice-period-too-long". */
  readonly code: string;
  readonly severity: Severity;
  /** The provision the finding is about. */
  readonly ref: ArticleRef;
  /** Plain-language explanation. */
  readonly message: string;
  /** What it is about, e.g. a service id, charge id or JSON path. */
  readonly subject?: string;
}

export function finding(code: string, severity: Severity, ref: ArticleRef, message: string, subject?: string): Finding {
  return subject === undefined ? { code, severity, ref, message } : { code, severity, ref, message, subject };
}

/** Counts per severity. */
export function countBySeverity(findings: readonly Finding[]): Record<Severity, number> {
  const out: Record<Severity, number> = { conflict: 0, missing: 0, review: 0, info: 0 };
  for (const f of findings) out[f.severity]++;
  return out;
}

const ORDER: Record<Severity, number> = { conflict: 0, missing: 1, review: 2, info: 3 };

/** Sorts by severity, keeping the original order within a severity. */
export function sortFindings(findings: readonly Finding[]): Finding[] {
  return findings.map((f, i) => ({ f, i })).sort((a, b) => ORDER[a.f.severity] - ORDER[b.f.severity] || a.i - b.i).map((x) => x.f);
}

/**
 * The one-line summary of a check. It never says that anything is compliant: a check can only show gaps in the
 * information it was given.
 */
export function summarise(findings: readonly Finding[]): string {
  const c = countBySeverity(findings);
  const actionable = c.conflict + c.missing + c.review;
  if (actionable === 0) return 'No gaps found in the information provided. This is not a legal assessment and does not mean the terms meet Regulation (EU) 2023/2854.';
  return `${c.conflict} conflict(s), ${c.missing} missing item(s), ${c.review} item(s) to review. This is not a legal assessment.`;
}
