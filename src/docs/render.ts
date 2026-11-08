// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

import { EUR_LEX_URL } from '../legal/refs.ts';
import { cspHash, html, raw, safeHref, type SafeHtml } from '../util/html.ts';
import { ATTRIBUTION, DISCLAIMER, type Block, type DocFormat, type OfframpDocument } from './model.ts';

const MD_INLINE = /[\\`*_[\]|~<>&]/gu;

/**
 * Escapes text for Markdown so it renders literally: inline Markdown punctuation is backslash-escaped,
 * `<`, `>` and `&` become entities (no HTML, autolinks or link syntax can be injected), and a leading
 * character that would start a heading, list or quote is escaped. Line breaks become spaces; use separate
 * blocks for separate lines.
 */
export function escapeMarkdown(text: string): string {
  return joinLines(text)
    .replace(MD_INLINE, (c) => (c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '&' ? '&amp;' : `\\${c}`))
    .replace(/^(\s*)([#+=-])/u, '$1\\$2')
    .replace(/^(\s*\d+)([.)])/u, '$1\\$2');
}

/**
 * Replaces every run of white space that contains a line feed with one space, in linear time. (The regular
 * expression /\s*\n\s*\/g does the same but backtracks quadratically over long runs of spaces.)
 */
function joinLines(text: string): string {
  if (!text.includes('\n')) return text;
  const parts = text.split('\n');
  const last = parts.length - 1;
  const kept = parts.map((p, i) => (i === 0 ? p.trimEnd() : i === last ? p.trimStart() : p.trim())).filter((p, i) => i === 0 || i === last || p !== '');
  return kept.join(' ');
}

/** Paragraph text keeps its line breaks as Markdown hard breaks. */
function mdParagraph(text: string): string {
  return text
    .split('\n')
    .map((l) => escapeMarkdown(l.trim()))
    .filter((l) => l !== '')
    .join('  \n');
}

function mdUrl(url: string): string | undefined {
  const href = safeHref(url);
  // Percent-encode characters that would end or confuse a Markdown link destination.
  return href?.replace(/[()<>\s"'\\]/gu, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`);
}

function mdBlock(b: Block): string {
  switch (b.kind) {
    case 'paragraph':
      return mdParagraph(b.text);
    case 'note':
      return `> ${mdParagraph(b.text).replace(/ {2}\n/gu, '  \n> ')}`;
    case 'list':
      return b.items.map((i) => `- ${escapeMarkdown(i)}`).join('\n');
    case 'facts':
      return b.rows.map(([k, v]) => `- **${escapeMarkdown(k)}:** ${escapeMarkdown(v)}`).join('\n');
    case 'link': {
      const u = mdUrl(b.url);
      return u === undefined ? escapeMarkdown(`${b.label}: ${b.url}`) : `[${escapeMarkdown(b.label)}](${u})`;
    }
    case 'table': {
      const cell = (s: string): string => escapeMarkdown(s) || ' ';
      const head = `| ${b.head.map(cell).join(' | ')} |`;
      const sep = `|${b.head.map(() => ' --- ').join('|')}|`;
      const rows = b.rows.map((r) => `| ${b.head.map((_, i) => cell(r[i] ?? '')).join(' | ')} |`);
      return [head, sep, ...rows].join('\n');
    }
  }
}

/** Renders a document as GitHub-flavoured Markdown. All document text is escaped. */
export function renderMarkdown(doc: OfframpDocument): string {
  const out: string[] = [`# ${escapeMarkdown(doc.title)}`];
  if (doc.subtitle !== undefined) out.push(mdParagraph(doc.subtitle));
  out.push(`Generated ${escapeMarkdown(doc.generatedAt)}`);
  for (const s of doc.sections) {
    out.push(`## ${escapeMarkdown(s.heading)}`);
    if (s.refs.length > 0) out.push(`Legal basis: ${s.refs.map((r) => `[${escapeMarkdown(r.cite)}](${mdUrl(r.url) ?? EUR_LEX_URL})`).join(', ')}`);
    for (const b of s.blocks) out.push(mdBlock(b));
  }
  out.push('---', mdParagraph(DISCLAIMER), `[${escapeMarkdown(ATTRIBUTION.text)}](${ATTRIBUTION.url})`);
  return `${out.join('\n\n')}\n`;
}

/** Stylesheet of the HTML documents; allowed by its hash in the document's own CSP. */
export const DOC_CSS = `:root{color-scheme:light;--ink:#1b1f24;--muted:#57606a;--line:#d0d7de;--bg:#ffffff;--soft:#f6f8fa;--accent:#0b5cad}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
main{max-width:860px;margin:0 auto;padding:40px 16px 24px}
h1{font-size:1.75rem;line-height:1.25;margin:0 0 8px}
h2{font-size:1.2rem;margin:36px 0 8px;padding-top:12px;border-top:1px solid var(--line)}
.sub{color:var(--muted);margin:0 0 4px}
.meta,.refs{color:var(--muted);font-size:.875rem;margin:0 0 12px}
a{color:var(--accent)}
table{border-collapse:collapse;width:100%;margin:8px 0 16px;font-size:.9375rem;display:block;overflow-x:auto}
th,td{border:1px solid var(--line);padding:6px 10px;text-align:left;vertical-align:top}
th{background:var(--soft);font-weight:600}
dl{display:grid;grid-template-columns:minmax(120px,max-content) 1fr;gap:4px 16px;margin:8px 0 16px}
dt{font-weight:600}dd{margin:0;overflow-wrap:anywhere}
blockquote{margin:12px 0;padding:8px 14px;background:var(--soft);border-left:3px solid var(--line)}
p,li,td{overflow-wrap:break-word}
.nw{white-space:nowrap}
footer{max-width:860px;margin:0 auto;padding:16px 16px 40px;color:var(--muted);font-size:.875rem;border-top:1px solid var(--line)}
@media (max-width:640px){dl{grid-template-columns:minmax(0,1fr);gap:0}dd{margin-bottom:8px}table{display:table}thead{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}tr{display:block;padding:8px 0;border-bottom:1px solid var(--line)}td{display:grid;grid-template-columns:110px minmax(0,1fr);gap:10px;border:0;padding:2px 0;white-space:normal;overflow-wrap:anywhere}td::before{content:attr(data-label);color:var(--muted);font-size:.8125rem;white-space:normal}}
@media print{main{padding-top:0}a{color:inherit}}`;

/** Content Security Policy of the HTML documents: no scripts, no network, only the stylesheet above. */
export const DOC_CSP = `default-src 'none'; style-src ${cspHash(DOC_CSS)}; img-src 'none'; base-uri 'none'; form-action 'none'`;

function htmlLink(label: string, url: string): SafeHtml {
  const href = safeHref(url);
  return href === undefined ? html`${label} (${url})` : html`<a href="${href}" rel="noopener noreferrer nofollow">${label}</a>`;
}

function htmlParagraph(text: string): SafeHtml {
  const lines = text.split('\n').map((l) => l.trim());
  return html`<p>${lines.map((l, i) => (i === 0 ? html`${l}` : html`<br>${l}`))}</p>`;
}

function htmlBlock(b: Block): SafeHtml {
  switch (b.kind) {
    case 'paragraph':
      return htmlParagraph(b.text);
    case 'note':
      return html`<blockquote>${htmlParagraph(b.text)}</blockquote>`;
    case 'list':
      return html`<ul>${b.items.map((i) => html`<li>${i}</li>`)}</ul>`;
    case 'facts':
      return html`<dl>${b.rows.map(([k, v]) => html`<dt>${k}</dt><dd>${v}</dd>`)}</dl>`;
    case 'link':
      return html`<p>${htmlLink(b.label, b.url)}</p>`;
    case 'table':
      return html`<table><thead><tr>${b.head.map((h) => html`<th scope="col">${h}</th>`)}</tr></thead><tbody>${b.rows.map(
        (r) => html`<tr>${b.head.map((h, i) => { const v = r[i] ?? ''; return v.length <= 14 ? html`<td class="nw" data-label="${h}">${v}</td>` : html`<td data-label="${h}">${v}</td>`; })}</tr>`,
      )}</tbody></table>`;
  }
}

/**
 * Renders a self-contained HTML page: inline stylesheet allowed by hash, a CSP meta tag that forbids scripts,
 * network access and forms, every value escaped, and the attribution footer.
 */
export function renderHtml(doc: OfframpDocument): string {
  const body = html`<!doctype html>
<html lang="${doc.language}">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${DOC_CSP}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<meta name="generator" content="${ATTRIBUTION.text}">
<title>${doc.title}</title>
<style>${raw(DOC_CSS)}</style>
</head>
<body>
<main>
<h1>${doc.title}</h1>
${doc.subtitle === undefined ? raw('') : html`<p class="sub">${doc.subtitle}</p>`}
<p class="meta">Generated ${doc.generatedAt}</p>
${doc.sections.map(
  (s) => html`<section>
<h2>${s.heading}</h2>
${s.refs.length === 0 ? raw('') : html`<p class="refs">Legal basis: ${s.refs.map((r, i) => html`${i === 0 ? '' : ', '}${htmlLink(r.cite, r.url)}`)}</p>`}
${s.blocks.map((b) => html`${htmlBlock(b)}
`)}</section>
`,
)}</main>
<footer>
<p>${DISCLAIMER}</p>
<p><a href="${ATTRIBUTION.url}" rel="noopener noreferrer">${ATTRIBUTION.text}</a></p>
</footer>
</body>
</html>
`;
  return body.value;
}

/** Renders the document as JSON, with the generator attribution and disclaimer. */
export function renderJson(doc: OfframpDocument): string {
  return `${JSON.stringify({ format: 'offramp/document', version: 1, generator: `${ATTRIBUTION.text} (${ATTRIBUTION.url})`, disclaimer: DISCLAIMER, ...doc }, null, 2)}\n`;
}

export function renderDocument(doc: OfframpDocument, format: DocFormat): string {
  return format === 'md' ? renderMarkdown(doc) : format === 'html' ? renderHtml(doc) : renderJson(doc);
}

/** Media type for each format. */
export const DOC_MEDIA_TYPES: Readonly<Record<DocFormat, string>> = {
  md: 'text/markdown; charset=utf-8',
  html: 'text/html; charset=utf-8',
  json: 'application/json; charset=utf-8',
};

