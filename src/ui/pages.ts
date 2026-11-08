// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

import { ATTRIBUTION, DISCLAIMER, DOC_FORMATS, type DocKind } from '../docs/model.ts';
import type { Timeline } from '../engine/timeline.ts';
import { EUR_LEX_URL, LAW } from '../legal/refs.ts';
import { CHARGE_KINDS, type ProviderProfile } from '../model/profile.ts';
import type { SwitchingRequest } from '../model/request.ts';
import type { ProfileReport } from '../rules/contract.ts';
import type { Finding } from '../rules/findings.ts';
import { formatLocal } from '../time/zone.ts';
import { html, raw, type SafeHtml } from '../util/html.ts';
import { VERSION } from '../version.ts';

export interface PageCtx {
  readonly csrf: string;
  readonly profile: ProviderProfile;
}

export interface Flash {
  readonly kind: 'ok' | 'bad';
  readonly text: string;
}

const EMPTY = raw('');

function csrfField(ctx: PageCtx): SafeHtml {
  return html`<input type="hidden" name="_csrf" value="${ctx.csrf}">`;
}

/** Full page. Every value is escaped by the `html` tag; the page loads no script. */
export function layout(title: string, body: SafeHtml, ctx: PageCtx | undefined, flash?: Flash): string {
  return html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} - Offramp</title>
<link rel="stylesheet" href="/static/app.css">
</head>
<body>
<header class="top"><div class="bar">
<a class="brand" href="/">Offramp</a>
${
  ctx === undefined
    ? EMPTY
    : html`<nav aria-label="Main">
<a href="/">Requests</a>
<a href="/new">New request</a>
<a href="/profile">Provider profile</a>
<a href="/about">About</a>
<form method="post" action="/logout">${csrfField(ctx)}<button class="link" type="submit">Lock</button></form>
</nav>`
}
</div></header>
<main>
${flash === undefined ? EMPTY : html`<p class="flash ${flash.kind}" role="${flash.kind === 'bad' ? 'alert' : 'status'}">${flash.text}</p>`}
${body}
</main>
<footer class="bottom"><div class="bar">
<span><a href="${ATTRIBUTION.url}" rel="noopener noreferrer">${ATTRIBUTION.text}</a> · version ${VERSION}</span>
<span>Not legal advice.</span>
</div></footer>
</body>
</html>
`.value;
}

export function loginPage(): SafeHtml {
  return html`<h1>Locked</h1>
<p class="lead">Open the one-time link that <code>offramp ui</code> printed in the terminal. Run the command again for a new link.</p>`;
}

export function errorPage(text: string): SafeHtml {
  return html`<h1>Something went wrong</h1><p>${text}</p><p><a href="/">Back to requests</a></p>`;
}

function status(s: string): SafeHtml {
  return html`<span class="status ${s}">${s}</span>`;
}

function targetText(req: SwitchingRequest): string {
  return req.target.kind === 'provider' ? `To ${req.target.providerName}` : req.target.kind === 'on-premises' ? 'To on-premises' : 'Erase only';
}

export interface HomeRow {
  readonly request: SwitchingRequest;
  readonly timeline: Timeline;
}

export function homePage(rows: readonly HomeRow[], errors: readonly { file: string; message: string }[]): SafeHtml {
  const nextOf = (t: Timeline): string => {
    const m = t.milestones.find((x) => x.status === 'upcoming' || x.status === 'due');
    return m === undefined ? '—' : `${m.date} · ${m.label}`;
  };
  return html`<h1>Switching requests</h1>
<p class="lead">Requests to switch away from the services in the provider profile, with every date that follows from Article 25 of the Data Act.</p>
${
  rows.length === 0
    ? html`<p>No requests yet. <a href="/new">Record a switching request</a>.</p>`
    : html`<div class="scroll"><table class="rows">
<thead><tr><th scope="col">Request</th><th scope="col">Customer</th><th scope="col">Decision</th><th scope="col">State</th><th scope="col">Next date</th></tr></thead>
<tbody>${rows.map(
        (r) => html`<tr><td class="nw" data-label="Request"><a href="/requests/${r.request.id}">${r.request.id}</a></td><td data-label="Customer">${r.request.customer.name}</td><td data-label="Decision">${targetText(r.request)}</td><td data-label="State">${status(r.timeline.state)}</td><td data-label="Next date">${nextOf(r.timeline)}</td></tr>`,
      )}</tbody></table></div>`
}
${errors.length === 0 ? EMPTY : html`<h2>Files that could not be read</h2><ul>${errors.map((e) => html`<li>${e.file}: ${e.message}</li>`)}</ul>`}`;
}

function textInput(name: string, placeholder: string, value = '', type = 'text', required = false, scope = ''): SafeHtml {
  return html`<label class="sr-only" for="f-${scope}${name}">${placeholder}</label><input id="f-${scope}${name}" type="${type}" name="${name}" placeholder="${placeholder}" value="${value}" maxlength="4000"${required ? raw(' required') : EMPTY}>`;
}

function textArea(name: string, placeholder: string, required = false, scope = ''): SafeHtml {
  return html`<label class="sr-only" for="f-${scope}${name}">${placeholder}</label><textarea id="f-${scope}${name}" name="${name}" placeholder="${placeholder}" maxlength="4000"${required ? raw(' required') : EMPTY}></textarea>`;
}

export interface NewRequestValues {
  readonly id: string;
  readonly receivedAt: string;
}

export function newRequestPage(ctx: PageCtx, values: NewRequestValues): SafeHtml {
  const p = ctx.profile;
  return html`<h1>New switching request</h1>
<p class="lead">Record a request to switch to another provider, to on-premises infrastructure, or to erase the data (Article 25(3)).</p>
<form class="stack" method="post" action="/requests">
${csrfField(ctx)}
<div class="grid">
<div class="stack">
${textInput('id', 'Request id', values.id, 'text', true)}
${textInput('customerName', 'Customer name', '', 'text', true)}
${textInput('customerRef', 'Customer or contract number (optional)')}
${textInput('customerEmail', 'Customer e-mail (optional)', '', 'email')}
${textInput('receivedAt', 'Request made at, e.g. 2026-03-01T09:30', values.receivedAt, 'text', true)}
${textInput('transitionStart', 'Transition start, optional (YYYY-MM-DD)')}
${textInput('retrievalDays', `Retrieval days, optional (${LAW.minRetrievalDays} or more)`)}
</div>
<div class="stack">
<fieldset><legend>Services</legend><div class="checks">${p.services.map((s) => html`<label><input type="checkbox" name="service" value="${s.id}"> ${s.name}</label>`)}</div></fieldset>
<fieldset><legend>Decision</legend><div class="choices">
<label><input type="radio" name="target" value="provider" checked> Switch to another provider</label>
<label><input type="radio" name="target" value="on-premises"> Switch to on-premises</label>
<label><input type="radio" name="target" value="erase"> Erase only</label>
</div></fieldset>
${textInput('destination', 'Destination provider (if switching)')}
${textArea('details', 'Details of the destination (optional)')}
</div>
</div>
<fieldset><legend>Data and digital assets to port</legend>
<p class="muted">Leave all unticked to include every exportable data category and digital asset of the chosen services. Ignored for erase-only requests.</p>
<div class="grid">${p.services.map(
    (s) => html`<div class="checks"><h3>${s.name}</h3>
${(s.exportableData ?? []).map((c) => html`<label><input type="checkbox" name="category" value="${c.id}"> ${c.name}</label>`)}
${(s.digitalAssets ?? []).map((a) => html`<label><input type="checkbox" name="asset" value="${a.id}"> ${a.name} (digital asset)</label>`)}
</div>`,
  )}</div></fieldset>
<button type="submit">Record request</button>
</form>`;
}

function findingsTable(findings: readonly Finding[]): SafeHtml {
  if (findings.length === 0) return html`<p class="muted">None.</p>`;
  return html`<div class="scroll"><table class="rows"><thead><tr><th scope="col">Severity</th><th scope="col">Point</th><th scope="col">Article</th></tr></thead><tbody>${findings.map(
    (f) => html`<tr><td data-label="Severity">${status(f.severity)}</td><td data-label="Point"><span>${f.subject === undefined ? EMPTY : html`<span class="muted">${f.subject}:</span> `}${f.message}</span></td><td class="nw" data-label="Article"><a href="${f.ref.url}" rel="noopener noreferrer">${f.ref.cite}</a></td></tr>`,
  )}</tbody></table></div>`;
}

function eventForm(ctx: PageCtx, id: string, rev: string, type: string, title: string, fields: SafeHtml, button: string): SafeHtml {
  return html`<form class="stack panel" method="post" action="/requests/${id}/events">
${csrfField(ctx)}<input type="hidden" name="rev" value="${rev}"><input type="hidden" name="type" value="${type}">
<h3>${title}</h3>
${fields}
<button type="submit" class="quiet">${button}</button>
</form>`;
}

/** Which documents can be produced for a request, given what is recorded. */
export function availableDocs(req: SwitchingRequest): DocKind[] {
  const has = (t: string): boolean => req.events.some((e) => e.type === t);
  const out: DocKind[] = ['switching-plan', 'receipt-notice'];
  if (has('unfeasibility-notified')) out.push('unfeasibility-notice');
  if (has('customer-extension')) out.push('extension-confirmation');
  if (has('switching-completed')) out.push('completion-notice');
  if (has('erasure-confirmed')) out.push('erasure-confirmation');
  return out;
}

const DOC_LABEL: Record<DocKind, string> = {
  'information-pack': 'Information pack',
  'switching-plan': 'Switching plan',
  'receipt-notice': 'Receipt of the switching request',
  'unfeasibility-notice': 'Technical unfeasibility notice',
  'extension-confirmation': 'Extension confirmation',
  'completion-notice': 'Completion and termination notice',
  'erasure-confirmation': 'Erasure confirmation',
};

function docLinks(base: string, kinds: readonly DocKind[]): SafeHtml {
  return html`<ul class="docs">${kinds.map(
    (k) => html`<li>${DOC_LABEL[k]}: ${DOC_FORMATS.map((f, i) => html`${i === 0 ? '' : ' · '}<a href="${base}/${k}?format=${f}">${f === 'md' ? 'Markdown' : f.toUpperCase()}</a>`)}</li>`,
  )}</ul>`;
}

export function requestPage(ctx: PageCtx, req: SwitchingRequest, rev: string, t: Timeline, chargeFindings: readonly Finding[], now: string): SafeHtml {
  const p = ctx.profile;
  const has = (type: string): boolean => req.events.some((e) => e.type === type);
  const closed = has('erasure-confirmed') || has('cancelled');
  const erase = req.target.kind === 'erase';
  const completed = has('switching-completed');
  const forms: SafeHtml[] = [];
  // Every form gets its own field ids (scope prefix), so each label points at its own field.
  const atField = (scope: string): SafeHtml => textInput('at', 'When, e.g. 2026-03-01T09:30', now, 'text', true, `${scope}-`);
  if (!closed && !erase && !completed) {
    if (!has('transition-started')) forms.push(eventForm(ctx, req.id, rev, 'transition-started', 'Transitional period started', atField('start'), 'Record start'));
    if (!has('unfeasibility-notified')) {
      forms.push(
        eventForm(
          ctx,
          req.id,
          rev,
          'unfeasibility-notified',
          'Technical unfeasibility (Art. 25(4))',
          html`${atField('unfeasible')}${textArea('reasons', 'Reasons why 30 days are technically unfeasible', true, 'unfeasible-')}${textInput('until', `Alternative period ends, by ${t.transition?.alternativeCapLastDay ?? ''}`, '', 'text', true, 'unfeasible-')}`,
          'Record notification',
        ),
      );
    }
    if (!has('customer-extension')) forms.push(eventForm(ctx, req.id, rev, 'customer-extension', "Customer's extension (Art. 25(5))", html`${atField('extension')}${textInput('until', 'New last day, YYYY-MM-DD', '', 'text', true, 'extension-')}`, 'Record extension'));
    forms.push(eventForm(ctx, req.id, rev, 'switching-completed', 'Switching completed (Art. 25(2)(c)(i))', atField('completed'), 'Record completion'));
  }
  if (!closed && (completed || erase)) forms.push(eventForm(ctx, req.id, rev, 'erasure-confirmed', 'Erasure confirmed (Art. 25(2)(h))', html`${atField('erasure')}${textArea('scope', 'What was erased (optional)', false, 'erasure-')}`, 'Record erasure'));
  if (!closed && !completed) forms.push(eventForm(ctx, req.id, rev, 'cancelled', 'Request withdrawn', html`${atField('cancel')}${textArea('reason', 'Reason (optional)', false, 'cancel-')}`, 'Record withdrawal'));
  const cur = p.charges?.currency ?? 'EUR';
  return html`<h1>Request ${req.id}</h1>
<p class="lead">${req.customer.name} · ${targetText(req)} · ${status(t.state)}</p>
<dl>
<dt>Services</dt><dd>${req.serviceIds.map((sid) => p.services.find((s) => s.id === sid)?.name ?? sid).join(', ')}</dd>
<dt>Request made</dt><dd>${formatLocal(req.receivedAt, p.timeZone)}</dd>
${req.customer.reference === undefined ? EMPTY : html`<dt>Customer reference</dt><dd>${req.customer.reference}</dd>`}
${req.target.kind !== 'erase' && req.target.details !== undefined ? html`<dt>Destination details</dt><dd>${req.target.details}</dd>` : EMPTY}
</dl>
<h2>Timeline</h2>
<div class="scroll"><table class="rows">
<thead><tr><th scope="col">Date</th><th scope="col">Milestone</th><th scope="col">Status</th><th scope="col">How</th><th scope="col">Article</th></tr></thead>
<tbody>${t.milestones.map((m) => html`<tr><td class="nw" data-label="Date">${m.date}</td><td data-label="Milestone">${m.label}</td><td data-label="Status">${status(m.status)}</td><td data-label="How">${m.basis}</td><td class="nw" data-label="Article"><a href="${m.ref.url}" rel="noopener noreferrer">${m.ref.cite}</a></td></tr>`)}</tbody>
</table></div>
<h2>Points to check</h2>
${findingsTable([...t.findings, ...chargeFindings].filter((f) => f.severity !== 'info'))}
${forms.length === 0 ? EMPTY : html`<h2>Record what happened</h2><div class="grid">${forms}</div>`}
<h2>Charges</h2>
${
  req.charges.length === 0
    ? html`<p class="muted">No charges recorded.</p>`
    : html`<div class="scroll"><table class="rows"><thead><tr><th scope="col">Charge</th><th scope="col">Kind</th><th scope="col">Amount</th><th scope="col">Imposed on</th></tr></thead><tbody>${req.charges.map(
        (c) => html`<tr><td data-label="Charge">${c.description ?? c.id}</td><td data-label="Kind">${c.kind}</td><td class="nw" data-label="Amount">${(c.amountMinor / 100).toFixed(2)} ${cur}</td><td class="nw" data-label="Imposed on">${c.imposedOn}</td></tr>`,
      )}</tbody></table></div>`
}
${
  closed
    ? EMPTY
    : html`<form class="stack panel" method="post" action="/requests/${req.id}/charges">
${csrfField(ctx)}<input type="hidden" name="rev" value="${rev}">
<h3>Record a charge</h3>
<div class="grid"><div class="stack">
${textInput('chargeId', 'Charge id, e.g. egress-1', '', 'text', true)}
${textInput('amount', `Amount in ${cur}, e.g. 120.00`, '', 'text', true)}
${textInput('cost', `Directly linked cost in ${cur} (optional)`)}
${textInput('imposedOn', 'Imposed on, YYYY-MM-DD', '', 'text', true)}
${textInput('description', 'Description (optional)')}
</div>
<fieldset><legend>Kind</legend><div class="checks">${CHARGE_KINDS.map((k, i) => html`<label><input type="radio" name="kind" value="${k}"${i === 0 ? raw(' checked') : EMPTY}> ${k}</label>`)}
<label><input type="checkbox" name="customerRequested" value="1"> Requested by the customer</label>
<label><input type="checkbox" name="priceAgreed" value="1"> Price agreed in advance</label></div></fieldset>
</div>
<button type="submit" class="quiet">Record charge</button>
</form>`
}
<h2>Documents</h2>
${docLinks(`/requests/${req.id}/doc`, availableDocs(req))}
<p><a href="/requests/${req.id}/export">Export the request (JSON exchange file)</a></p>
<h2>Assumptions</h2>
<ul>${t.assumptions.map((a) => html`<li>${a}</li>`)}</ul>`;
}

export function profilePage(ctx: PageCtx, report: ProfileReport): SafeHtml {
  const p = ctx.profile;
  return html`<h1>${p.provider.name}</h1>
<p class="lead">Review of the provider profile against Chapter VI. ${report.summary}</p>
<h2>Documents</h2>
${docLinks('/profile/doc', ['information-pack'])}
<h2>Findings</h2>
${findingsTable(report.findings.filter((f) => f.severity !== 'info'))}
<h2>Notes</h2>
${findingsTable(report.findings.filter((f) => f.severity === 'info'))}`;
}

export function aboutPage(): SafeHtml {
  return html`<h1>About</h1>
<p><a href="${ATTRIBUTION.url}" rel="noopener noreferrer">${ATTRIBUTION.text}</a>, version ${VERSION}. Licensed under the GNU Affero General Public License version 3 with additional terms (LICENSE-ADDITIONAL-TERMS.md). A commercial licence is available.</p>
<p>Offramp works out the periods of Article 25 of Regulation (EU) 2023/2854 (Data Act), checks switching charges against Article 29 and reviews provider information against Chapter VI. It shows gaps in the information it is given; it never states that anyone meets the Regulation.</p>
<p>${DISCLAIMER}</p>
<p><a href="${EUR_LEX_URL}" rel="noopener noreferrer">Official text on EUR-Lex</a></p>
<p class="muted">This interface runs on your computer. It stores requests only in the folder you chose and sends nothing anywhere.</p>`;
}
