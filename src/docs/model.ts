// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

import type { ArticleRef } from '../legal/refs.ts';

/**
 * Documents are built as data first (this model) and rendered to Markdown, HTML or JSON afterwards. All escaping
 * happens in the renderers, so generators never build markup from user text.
 */

export const DOC_KINDS = ['information-pack', 'switching-plan', 'receipt-notice', 'unfeasibility-notice', 'extension-confirmation', 'completion-notice', 'erasure-confirmation'] as const;
export type DocKind = (typeof DOC_KINDS)[number];

export const DOC_FORMATS = ['md', 'html', 'json'] as const;
export type DocFormat = (typeof DOC_FORMATS)[number];

export type Block =
  | { readonly kind: 'paragraph'; readonly text: string }
  | { readonly kind: 'list'; readonly items: readonly string[] }
  | { readonly kind: 'table'; readonly head: readonly string[]; readonly rows: readonly (readonly string[])[] }
  | { readonly kind: 'facts'; readonly rows: readonly (readonly [string, string])[] }
  | { readonly kind: 'link'; readonly label: string; readonly url: string }
  | { readonly kind: 'note'; readonly text: string };

export interface DocSection {
  readonly heading: string;
  readonly refs: readonly ArticleRef[];
  readonly blocks: readonly Block[];
}

export interface OfframpDocument {
  readonly kind: DocKind;
  readonly title: string;
  readonly subtitle?: string;
  /** Language of the text. Offramp authors English only. */
  readonly language: 'en';
  readonly generatedAt: string;
  readonly sections: readonly DocSection[];
}

/** Attribution required by LICENSE-ADDITIONAL-TERMS.md (AGPL section 7(b)). */
export const ATTRIBUTION = { text: 'Offramp by AFKzona Group', url: 'https://afkzonagroup.lt' } as const;

export const DISCLAIMER = 'Prepared from the information provided, with Offramp. It is not legal advice and does not establish that anyone meets Regulation (EU) 2023/2854.';
