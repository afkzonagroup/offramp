// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { generateDocument, informationPack } from '../src/docs/generate.ts';
import { ATTRIBUTION, DOC_FORMATS, DOC_KINDS, type DocKind, type OfframpDocument } from '../src/docs/model.ts';
import { DOC_CSP, DOC_CSS, escapeMarkdown, renderDocument, renderHtml, renderJson, renderMarkdown } from '../src/docs/render.ts';
import { escapeHtml, safeHref } from '../src/util/html.ts';
import { ms, profile, request } from './helpers.ts';

const NOW = ms('2027-12-01T10:00:00Z');
const FULL_EVENTS = [
  { type: 'unfeasibility-notified', at: '2026-11-05T10:00:00.000Z', reasons: 'Large archive.\nNeeds staged copy.', alternativeTransitionEnd: '2027-04-30' },
  { type: 'customer-extension', at: '2026-11-06T10:00:00.000Z', newTransitionEnd: '2027-05-31' },
  { type: 'switching-completed', at: '2027-05-20T10:00:00.000Z' },
  { type: 'erasure-confirmed', at: '2027-07-01T10:00:00.000Z', scope: 'All data and assets' },
];

const EVIL = '<script>alert(1)</script> "><img src=x onerror=alert(2)> [click](javascript:alert(3)) | # x ` * _ ~ &amp;';

function evilRequest(): ReturnType<typeof request> {
  return request({
    customer: { name: EVIL, reference: '<b>ref</b>' },
    target: { kind: 'provider', providerName: '](javascript:alert(4))', details: '- list\n# heading\n<iframe src=x>' },
    events: FULL_EVENTS.map((e) => (e.type === 'unfeasibility-notified' ? { ...e, reasons: EVIL } : e.type === 'erasure-confirmed' ? { ...e, scope: EVIL } : e)),
    charges: [{ id: 'c1', kind: 'data-egress', amountMinor: 100, imposedOn: '2027-02-01', description: EVIL }],
  });
}

function allDocs(): [DocKind, OfframpDocument][] {
  const p = profile({ 'provider.name': 'Example Cloud' });
  const r = request({ events: FULL_EVENTS, charges: [{ id: 'c1', kind: 'data-egress', amountMinor: 100, imposedOn: '2027-02-01' }] });
  return DOC_KINDS.map((k) => [k, generateDocument(k, p, k === 'information-pack' ? undefined : r, { now: NOW })]);
}

describe('documents', () => {
  it.each(DOC_KINDS)('generates %s in every format with attribution and disclaimer', (kind) => {
    const doc = allDocs().find(([k]) => k === kind)?.[1];
    if (doc === undefined) throw new Error('missing');
    expect(doc.sections.length).toBeGreaterThan(0);
    expect(doc.generatedAt).toBe('2027-12-01T10:00:00.000Z');
    for (const f of DOC_FORMATS) {
      const out = renderDocument(doc, f);
      expect(out).toContain(ATTRIBUTION.text);
      expect(out).toContain(ATTRIBUTION.url);
      expect(out).toMatch(/not legal advice/i);
      expect(out).not.toMatch(/\bcompliant\b/i);
    }
  });

  it('puts the statutory periods and legal links in the information pack', () => {
    const md = renderMarkdown(informationPack(profile(), { now: NOW }));
    for (const s of ['At most two months', 'At most 30 calendar days', '14 working days', 'at most 7 months', 'At least 30 calendar days', 'From 2027-01-12, no switching charges', 'https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32023R2854#art_25']) {
      expect(md).toContain(s);
    }
    expect(md).toContain('clause 14.2');
    expect(md).toContain('[Online register of data structures, data formats, standards and open interoperability specifications](https://docs.cloud.example.com/data-register)');
  });

  it('shows "Not stated" for gaps instead of inventing content', () => {
    const p = profile({ contract: undefined, information: undefined, charges: undefined, internationalAccess: undefined, 'services.1.digitalAssets': undefined, 'services.1.knownRestrictions': undefined, 'services.1.switchingMethods': undefined });
    const md = renderMarkdown(informationPack(p, { now: NOW }));
    expect(md).toContain('Not stated');
    expect(md).toContain('Switching procedures: not stated.');
    expect(md).toContain('Address of the online register: not stated.');
    expect(md).toContain('Charges: not stated.');
    expect(md).toContain('Digital assets: not stated.');
  });

  it('lists services with specific regimes and skips non-production data', () => {
    const md = renderMarkdown(informationPack(profile({ 'services.1.regime': 'non-production', 'services.1.limitedPeriodDays': 30 }), { now: NOW }));
    expect(md).toContain('Obligations that do not apply');
    expect(md).not.toContain('Data and digital assets you can take: Example CRM');
  });

  it('describes erase-only requests without a transitional period', () => {
    const r = request({ target: { kind: 'erase' }, data: { categoryIds: [], assetIds: [] } });
    const md = renderMarkdown(generateDocument('receipt-notice', profile(), r, { now: ms('2026-11-08T00:00:00Z') }));
    expect(md).toContain('the contract ends at the end of the notice period (2026-12-30)');
    expect(md).not.toContain('Transitional period');
    expect(renderMarkdown(generateDocument('switching-plan', profile(), r, { now: NOW }))).not.toContain('Data and digital assets to port');
  });

  it('refuses event documents before the event is recorded, and request documents without a request', () => {
    const r = request();
    for (const k of ['unfeasibility-notice', 'extension-confirmation', 'completion-notice', 'erasure-confirmation'] as const) {
      expect(() => generateDocument(k, profile(), r, { now: NOW })).toThrow(/Record/);
    }
    expect(() => generateDocument('switching-plan', profile(), undefined)).toThrow(/needs a switching request/);
  });

  it('carries late-notification and early-erasure warnings into the notices', () => {
    const r = request({
      events: [
        { type: 'unfeasibility-notified', at: '2026-12-01T10:00:00.000Z', reasons: 'r', alternativeTransitionEnd: '2027-03-31' },
        { type: 'switching-completed', at: '2027-01-05T10:00:00.000Z' },
        { type: 'erasure-confirmed', at: '2027-01-06T10:00:00.000Z' },
      ],
    });
    expect(renderMarkdown(generateDocument('unfeasibility-notice', profile(), r, { now: NOW }))).toContain('after the last day (2026-11-20)');
    expect(renderMarkdown(generateDocument('erasure-confirmation', profile(), r, { now: NOW }))).toContain('check that the customer agreed');
  });

  it('includes points to check in the switching plan', () => {
    const r = request({ charges: [{ id: 'c1', kind: 'data-egress', amountMinor: 100, imposedOn: '2027-02-01' }] });
    const md = renderMarkdown(generateDocument('switching-plan', profile(), r, { now: NOW }));
    expect(md).toContain('From 2027-01-12 no switching charges may be imposed');
    expect(md).toContain('Assumptions');
  });

  it('flags a standard fee imposed after switching completed and the contract ended (Art. 25(2)(c)(i))', () => {
    const fee = { id: 'f1', kind: 'standard-service-fee', amountMinor: 4900, imposedOn: '2027-01-20' };
    const completed = request({ events: [{ type: 'switching-completed', at: '2027-01-05T10:00:00.000Z' }], charges: [fee] });
    expect(renderMarkdown(generateDocument('switching-plan', profile(), completed, { now: NOW }))).toContain('after the contract ended (2027-01-05)');
    // Not yet completed: the contract applies until the end of the transitional period (29 January 2027).
    expect(renderMarkdown(generateDocument('switching-plan', profile(), request({ charges: [fee] }), { now: NOW }))).not.toContain('after the contract ended');
  });
});

describe('escaping', () => {
  it('escapes everything in HTML documents', () => {
    const p = profile({ 'provider.name': EVIL, 'services.1.name': '<svg onload=alert(5)>' });
    for (const k of DOC_KINDS) {
      const out = renderHtml(generateDocument(k, p, k === 'information-pack' ? undefined : evilRequest(), { now: NOW }));
      expect(out, k).not.toMatch(/<script|<img|<iframe|<svg|<b>/i);
      expect(out, k).not.toMatch(/(href|src)="?javascript:/i);
      expect(out, k).not.toMatch(/\son\w+=/i);
      expect(out).toContain('&lt;script&gt;');
      // Exactly one <style> and no other active element types.
      expect(out.match(/<style>/g)).toHaveLength(1);
      expect(out).not.toMatch(/<(object|embed|form|base|link|meta http-equiv="refresh")/i);
    }
  });

  it('escapes everything in Markdown documents', () => {
    const p = profile({ 'provider.name': EVIL });
    for (const k of DOC_KINDS) {
      const out = renderMarkdown(generateDocument(k, p, k === 'information-pack' ? undefined : evilRequest(), { now: NOW }));
      expect(out, k).not.toMatch(/<script|<img|<iframe|<b>/i);
      // The text may mention javascript:, but never as a link target: brackets are escaped.
      expect(out, k).not.toMatch(/(?<!\\)\]\(javascript:/);
      expect(out, k).not.toMatch(/^# heading/m);
      expect(out, k).not.toMatch(/^- list/m);
    }
  });

  it('lets row labels wrap on phones, also next to short values that do not wrap', () => {
    expect(DOC_CSS).toMatch(/td::before\{[^}]*white-space:normal/);
  });

  it('escapes Markdown syntax precisely', () => {
    expect(escapeMarkdown('[a](b)')).toBe('\\[a\\](b)');
    expect(escapeMarkdown('<x> & y')).toBe('&lt;x&gt; &amp; y');
    expect(escapeMarkdown('# h')).toBe('\\# h');
    expect(escapeMarkdown('- item')).toBe('\\- item');
    expect(escapeMarkdown('+ item')).toBe('\\+ item');
    expect(escapeMarkdown('1. item')).toBe('1\\. item');
    expect(escapeMarkdown('12) item')).toBe('12\\) item');
    expect(escapeMarkdown('a | b')).toBe('a \\| b');
    expect(escapeMarkdown('`code` *b* _i_ ~s~ \\')).toBe('\\`code\\` \\*b\\* \\_i\\_ \\~s\\~ \\\\');
    expect(escapeMarkdown('line\nnext')).toBe('line next');
    expect(escapeMarkdown('2026-03-01 and 1.5')).toBe('2026-03-01 and 1.5');
    expect(escapeMarkdown(' a \t\n\r\n \n b \n')).toBe(' a b ');
    expect(escapeMarkdown('\n')).toBe(' ');
  });

  it('joins lines in linear time, even over long runs of spaces', () => {
    const spaces = ' '.repeat(200_000);
    const started = performance.now();
    expect(escapeMarkdown(`${spaces}x`)).toBe(`${spaces}x`);
    expect(escapeMarkdown(`a${spaces}\n${spaces}b`)).toBe('a b');
    // A backtracking /\s*\n\s*/ takes tens of seconds here.
    expect(performance.now() - started).toBeLessThan(2000);
  });

  it('keeps JSON documents as data', () => {
    const doc = generateDocument('switching-plan', profile(), evilRequest(), { now: NOW });
    const parsed = JSON.parse(renderJson(doc)) as { format: string; generator: string; kind: string; sections: unknown[] };
    expect(parsed.format).toBe('offramp/document');
    expect(parsed.kind).toBe('switching-plan');
    expect(parsed.generator).toContain('Offramp by AFKzona Group');
    expect(JSON.stringify(parsed)).toContain(EVIL.replace(/"/g, '\\"'));
  });

  it('links only http and https URLs', () => {
    expect(safeHref('javascript:alert(1)')).toBeUndefined();
    expect(safeHref('data:text/html,x')).toBeUndefined();
    expect(safeHref('not a url')).toBeUndefined();
    expect(safeHref('https://example.com/a?b=c')).toBe('https://example.com/a?b=c');
    const doc: OfframpDocument = { kind: 'information-pack', title: 'T', language: 'en', generatedAt: 'x', sections: [{ heading: 'H', refs: [], blocks: [{ kind: 'link', label: 'L', url: 'javascript:alert(1)' }, { kind: 'link', label: 'M', url: 'https://example.com/(a)' }] }] };
    expect(renderHtml(doc)).not.toContain('href="javascript');
    expect(renderMarkdown(doc)).not.toContain('](javascript');
    expect(renderMarkdown(doc)).toContain('[M](https://example.com/%28a%29)');
  });

  it('escapes HTML attribute characters', () => {
    expect(escapeHtml(`<a href="x" onclick='y'>\`=&`)).toBe('&lt;a href&#61;&quot;x&quot; onclick&#61;&#39;y&#39;&gt;&#96;&#61;&amp;');
  });
});

describe('HTML document hardening', () => {
  it('has a CSP that forbids scripts and network access, and allows only its own stylesheet by hash', () => {
    const hash = createHash('sha256').update(DOC_CSS, 'utf8').digest('base64');
    expect(DOC_CSP).toBe(`default-src 'none'; style-src 'sha256-${hash}'; img-src 'none'; base-uri 'none'; form-action 'none'`);
    const out = renderHtml(informationPack(profile(), { now: NOW }));
    expect(out).toContain('<meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;;');
    expect(out).toContain(`<style>${DOC_CSS}</style>`);
    expect(out).not.toMatch(/<script/i);
    expect(out).not.toMatch(/\sstyle=/i);
    expect(out).toContain('<meta name="referrer" content="no-referrer">');
    expect(out).toContain('<html lang="en">');
  });

  it('opens external links without referrer or opener', () => {
    const out = renderHtml(informationPack(profile(), { now: NOW }));
    for (const m of out.matchAll(/<a href="([^"]+)"([^>]*)>/g)) {
      expect(m[1]).toMatch(/^https:\/\//);
      expect(m[2]).toMatch(/rel="noopener noreferrer/);
    }
  });
});
