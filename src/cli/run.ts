// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

import { appendFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { exportRequest, importRequest } from '../connectors/exchange.ts';
import { schemaText } from '../connectors/schema.ts';
import { generateDocument } from '../docs/generate.ts';
import { ATTRIBUTION, DOC_FORMATS, DOC_KINDS, type DocFormat, type DocKind } from '../docs/model.ts';
import { renderDocument } from '../docs/render.ts';
import { addEvent, createRequest } from '../engine/lifecycle.ts';
import { computeTimeline, contractLastDay, type Timeline } from '../engine/timeline.ts';
import { EXAMPLE_PROFILE } from '../example.ts';
import { readTextFile, safePath, writeTextFile } from '../io/files.ts';
import { EUR_LEX_URL } from '../legal/refs.ts';
import { parseProfile, validateProfile } from '../model/parse-profile.ts';
import { checkRequestAgainstProfile, parseRequest, validateRequest } from '../model/parse-request.ts';
import { CHARGE_KINDS, type ProviderProfile } from '../model/profile.ts';
import { EVENT_TYPES, TARGET_KINDS, type SwitchingRequest, type SwitchingTarget } from '../model/request.ts';
import { checkAppliedCharges } from '../rules/charges.ts';
import { checkProfile } from '../rules/contract.ts';
import { countBySeverity, sortFindings, type Finding, type Severity } from '../rules/findings.ts';
import { parseInstant, toIso } from '../time/zone.ts';
import { OfframpError, publicMessage } from '../util/errors.ts';
import { MAX_JSON_BYTES } from '../util/json.ts';
import { ID_RE, printable } from '../util/validate.ts';
import { VERSION } from '../version.ts';

/** Everything the CLI touches outside its own logic, so tests can run it in-process. */
export interface CliIo {
  out(text: string): void;
  err(text: string): void;
  env(name: string): string | undefined;
  now(): number;
  /** Starts the local UI and resolves when it stops. Injected so tests can stub it. */
  serve?(opts: { profilePath: string; profile: ProviderProfile; dataDir: string; host: string; port: number; allowNonLoopback: boolean; allowedHosts: readonly string[] }): Promise<void>;
}

class UsageError extends OfframpError {
  constructor(message: string) {
    super('USAGE', message);
  }
}

export const HELP = `Offramp ${VERSION}: switching between data processing services under
Chapter VI of the Data Act, Regulation (EU) 2023/2854.

Usage:
  offramp profile check <profile.json> [--format text|json] [--fail-on LEVEL] [--github-output]
  offramp profile example [--out FILE] [--force]
  offramp schema profile|request
  offramp request create --profile P --id ID --customer NAME --service ID[,ID]
                         --target provider|on-premises|erase [--destination NAME]
                         [--details TEXT] [--data ID,..] [--assets ID,..]
                         [--received-at TIME] [--customer-ref REF] [--customer-email EMAIL]
                         [--transition-start DATE] [--retrieval-days N] [--out FILE] [--force]
  offramp request event <request.json> --profile P --type TYPE [--at TIME] [--reasons TEXT]
                         [--until DATE] [--scope TEXT] [--reason TEXT] [--note TEXT]
  offramp request charge <request.json> --profile P --id ID --kind KIND --amount MINOR
                         --imposed-on DATE [--cost MINOR] [--charge-id ID] [--description TEXT]
                         [--customer-requested] [--price-agreed]
  offramp request validate <request.json> [--profile P]
  offramp request export <request.json> [--out FILE] [--force]
  offramp request import <export.json> [--profile P] [--out FILE] [--force]
  offramp timeline <request.json> --profile P [--now TIME] [--format text|json]
  offramp docs <kind> --profile P [--request R] [--format md|html|json] [--out FILE] [--force]
  offramp ui --profile P --dir DIR [--host 127.0.0.1] [--port 4791]
             [--allow-non-loopback] [--allowed-host HOST[:PORT]]

Event types: ${EVENT_TYPES.join(', ')}
Document kinds: ${DOC_KINDS.join(', ')}
Charge kinds: ${CHARGE_KINDS.join(', ')}
--fail-on: conflict | missing | review | never (default conflict). Exit code 1 when a
finding at or above that level exists, 2 on invalid input.
TIME: 2026-03-01, 2026-03-01T09:30 (profile time zone) or 2026-03-01T09:30+01:00.

Offramp reports gaps in the information it is given. It is not legal advice and never
states that anyone meets the Regulation. Official text: ${EUR_LEX_URL}

${ATTRIBUTION.text} - ${ATTRIBUTION.url}
Licence: AGPL-3.0-only with additional terms (LICENSE-ADDITIONAL-TERMS.md).
`;

const OPTIONS = {
  format: { type: 'string' },
  'fail-on': { type: 'string' },
  'github-output': { type: 'boolean' },
  out: { type: 'string' },
  force: { type: 'boolean' },
  profile: { type: 'string' },
  request: { type: 'string' },
  id: { type: 'string' },
  customer: { type: 'string' },
  'customer-ref': { type: 'string' },
  'customer-email': { type: 'string' },
  service: { type: 'string' },
  target: { type: 'string' },
  destination: { type: 'string' },
  details: { type: 'string' },
  data: { type: 'string' },
  assets: { type: 'string' },
  'received-at': { type: 'string' },
  'transition-start': { type: 'string' },
  'retrieval-days': { type: 'string' },
  type: { type: 'string' },
  at: { type: 'string' },
  reasons: { type: 'string' },
  until: { type: 'string' },
  scope: { type: 'string' },
  reason: { type: 'string' },
  note: { type: 'string' },
  kind: { type: 'string' },
  amount: { type: 'string' },
  cost: { type: 'string' },
  'charge-id': { type: 'string' },
  description: { type: 'string' },
  'imposed-on': { type: 'string' },
  'customer-requested': { type: 'boolean' },
  'price-agreed': { type: 'boolean' },
  now: { type: 'string' },
  dir: { type: 'string' },
  host: { type: 'string' },
  port: { type: 'string' },
  'allow-non-loopback': { type: 'boolean' },
  'allowed-host': { type: 'string', multiple: true },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
} as const;

type Values = ReturnType<typeof parseArgs<{ options: typeof OPTIONS; allowPositionals: true; strict: true }>>['values'];

/** Options each command accepts; anything else is a usage error, so typos are never ignored. */
const ALLOWED: Readonly<Record<string, readonly (keyof typeof OPTIONS)[]>> = {
  'profile check': ['format', 'fail-on', 'github-output'],
  'profile example': ['out', 'force'],
  schema: [],
  'request create': ['profile', 'id', 'customer', 'customer-ref', 'customer-email', 'service', 'target', 'destination', 'details', 'data', 'assets', 'received-at', 'transition-start', 'retrieval-days', 'out', 'force'],
  'request event': ['profile', 'type', 'at', 'reasons', 'until', 'scope', 'reason', 'note'],
  'request charge': ['profile', 'id', 'kind', 'amount', 'cost', 'charge-id', 'description', 'imposed-on', 'customer-requested', 'price-agreed'],
  'request validate': ['profile'],
  'request export': ['out', 'force'],
  'request import': ['profile', 'out', 'force'],
  timeline: ['profile', 'now', 'format'],
  docs: ['profile', 'request', 'format', 'out', 'force', 'now'],
  ui: ['profile', 'dir', 'host', 'port', 'allow-non-loopback', 'allowed-host'],
};

function need(v: string | undefined, flag: string): string {
  if (v === undefined || v === '') throw new UsageError(`Missing --${flag}.`);
  return v;
}

function oneOfFlag<const T extends string>(v: string | undefined, flag: string, values: readonly T[], fallback?: T): T {
  if (v === undefined && fallback !== undefined) return fallback;
  if (v === undefined || !(values as readonly string[]).includes(v)) throw new UsageError(`--${flag} must be one of: ${values.join(', ')}.`);
  return v as T;
}

function idList(v: string | undefined, flag: string): string[] {
  if (v === undefined) return [];
  const ids = v.split(',').map((x) => x.trim()).filter((x) => x !== '');
  for (const x of ids) if (!ID_RE.test(x)) throw new UsageError(`--${flag}: "${printable(x, 64)}" is not a valid identifier.`);
  return ids;
}

function integer(v: string, flag: string, min: number, max: number): number {
  if (!/^\d{1,13}$/u.test(v)) throw new UsageError(`--${flag} must be a whole number.`);
  const n = Number(v);
  if (n < min || n > max) throw new UsageError(`--${flag} must be between ${min} and ${max}.`);
  return n;
}

async function loadProfile(path: string): Promise<ProviderProfile> {
  return parseProfile(await readTextFile(safePath(path, '--profile'), MAX_JSON_BYTES));
}

async function loadRequest(path: string): Promise<SwitchingRequest> {
  return parseRequest(await readTextFile(safePath(path, 'request file'), MAX_JSON_BYTES));
}

async function emit(io: CliIo, text: string, out: string | undefined, force: boolean | undefined): Promise<void> {
  if (out === undefined) {
    io.out(text);
    return;
  }
  const path = safePath(out, '--out');
  await writeTextFile(path, text, force === true);
  io.err(`Wrote ${printable(path, 300)}\n`);
}

function json(v: unknown): string {
  return `${JSON.stringify(v, null, 2)}\n`;
}

const LEVEL_ORDER: readonly Severity[] = ['conflict', 'missing', 'review'];

function failed(findings: readonly Finding[], failOn: Severity | 'never'): boolean {
  if (failOn === 'never') return false;
  const levels = LEVEL_ORDER.slice(0, LEVEL_ORDER.indexOf(failOn) + 1);
  return findings.some((f) => levels.includes(f.severity));
}

function findingLines(findings: readonly Finding[]): string {
  return findings.map((f) => `  [${f.severity}] ${f.ref.cite}${f.subject === undefined ? '' : ` (${printable(f.subject, 100)})`}: ${printable(f.message, 1000)}`).join('\n');
}

/** The `$GITHUB_OUTPUT` lines for a set of counts. Refuses anything but small non-negative integers. */
export function githubOutputLines(c: Readonly<Record<Severity, number>>): string[] {
  const lines = [`conflicts=${c.conflict}`, `missing=${c.missing}`, `review=${c.review}`, `findings=${c.conflict + c.missing + c.review}`];
  for (const l of lines) if (!/^[a-z]+=\d{1,6}$/u.test(l)) throw new OfframpError('IO', 'Refusing to write an unexpected output value.');
  return lines;
}

/** Writes counts from this run's in-memory result to $GITHUB_OUTPUT. Only integers are written. */
async function githubOutput(io: CliIo, findings: readonly Finding[]): Promise<void> {
  const path = io.env('GITHUB_OUTPUT');
  if (path === undefined || path === '') throw new UsageError('--github-output needs the GITHUB_OUTPUT environment variable.');
  const lines = githubOutputLines(countBySeverity(findings));
  await appendFile(safePath(path, 'GITHUB_OUTPUT'), `${lines.join('\n')}\n`, { encoding: 'utf8', mode: 0o600 });
}

function timelineText(t: Timeline): string {
  const lines = [`Request ${printable(t.requestId, 64)}: ${t.state} (as of ${t.now}, dates in ${t.timeZone})`, ''];
  for (const m of t.milestones) lines.push(`  ${m.date}  ${m.status.padEnd(9)}  ${m.label}  [${m.ref.cite}]`);
  const issues = t.findings.filter((f) => f.severity !== 'info');
  if (issues.length > 0) lines.push('', 'Points to check:', findingLines(issues));
  lines.push('', 'Assumptions:', ...t.assumptions.map((a) => `  - ${a}`));
  return `${lines.join('\n')}\n`;
}

async function profileCheck(io: CliIo, pos: readonly string[], v: Values): Promise<number> {
  const file = pos[0];
  if (file === undefined) throw new UsageError('Name the profile file: offramp profile check <profile.json>');
  const profile = await loadProfile(file);
  const report = checkProfile(profile);
  const format = oneOfFlag(v.format, 'format', ['text', 'json'] as const, 'text');
  const failOn = oneOfFlag(v['fail-on'], 'fail-on', ['conflict', 'missing', 'review', 'never'] as const, 'conflict');
  if (v['github-output'] === true) await githubOutput(io, report.findings);
  if (format === 'json') io.out(json({ generator: `${ATTRIBUTION.text} (${ATTRIBUTION.url})`, ...report }));
  else {
    const visible = report.findings.filter((f) => f.severity !== 'info');
    const info = report.findings.filter((f) => f.severity === 'info');
    io.out(`Provider profile: ${printable(report.provider, 200)}\n${report.summary}\n${visible.length === 0 ? '' : `\n${findingLines(visible)}\n`}${info.length === 0 ? '' : `\nNotes:\n${findingLines(info)}\n`}\n${ATTRIBUTION.text} - ${ATTRIBUTION.url}\n`);
  }
  return failed(report.findings, failOn) ? 1 : 0;
}

function target(v: Values): SwitchingTarget {
  const kind = oneOfFlag(v.target, 'target', TARGET_KINDS);
  if (kind === 'erase') {
    if (v.destination !== undefined || v.details !== undefined) throw new UsageError('--destination and --details do not apply to --target erase.');
    return { kind };
  }
  if (kind === 'on-premises') {
    if (v.destination !== undefined) throw new UsageError('--destination applies to --target provider only.');
    return v.details === undefined ? { kind } : { kind, details: v.details };
  }
  const providerName = need(v.destination, 'destination');
  return v.details === undefined ? { kind, providerName } : { kind, providerName, details: v.details };
}

async function requestCreate(io: CliIo, v: Values): Promise<number> {
  const profile = await loadProfile(need(v.profile, 'profile'));
  const now = io.now();
  const receivedAt = v['received-at'] === undefined ? toIso(now) : parseInstant(v['received-at'], profile.timeZone);
  if (Date.parse(receivedAt) > now) throw new UsageError('--received-at is in the future.');
  const tg = target(v);
  const data = v.data !== undefined || v.assets !== undefined ? { categoryIds: idList(v.data, 'data'), assetIds: idList(v.assets, 'assets') } : undefined;
  const req = createRequest(profile, {
    id: need(v.id, 'id'),
    customer: {
      name: need(v.customer, 'customer'),
      ...(v['customer-ref'] === undefined ? {} : { reference: v['customer-ref'] }),
      ...(v['customer-email'] === undefined ? {} : { contactEmail: v['customer-email'] }),
    },
    serviceIds: idList(need(v.service, 'service'), 'service'),
    target: tg,
    ...(data === undefined ? {} : { data }),
    receivedAt,
    ...(v['transition-start'] === undefined ? {} : { transitionStartDate: v['transition-start'] }),
    ...(v['retrieval-days'] === undefined ? {} : { retrievalDays: integer(v['retrieval-days'], 'retrieval-days', 1, 3650) }),
  });
  await emit(io, json(req), v.out, v.force);
  return 0;
}

async function requestEvent(io: CliIo, pos: readonly string[], v: Values): Promise<number> {
  const file = pos[0];
  if (file === undefined) throw new UsageError('Name the request file: offramp request event <request.json> ...');
  const profile = await loadProfile(need(v.profile, 'profile'));
  const req = await loadRequest(file);
  checkRequestAgainstProfile(req, profile);
  const type = oneOfFlag(v.type, 'type', EVENT_TYPES);
  const now = io.now();
  const at = v.at === undefined ? toIso(now) : parseInstant(v.at, profile.timeZone);
  const event: Record<string, unknown> = { type, at };
  if (v.note !== undefined) event.note = v.note;
  if (type === 'unfeasibility-notified') {
    event.reasons = need(v.reasons, 'reasons');
    event.alternativeTransitionEnd = need(v.until, 'until');
  } else if (type === 'customer-extension') event.newTransitionEnd = need(v.until, 'until');
  else if (type === 'erasure-confirmed' && v.scope !== undefined) event.scope = v.scope;
  else if (type === 'cancelled' && v.reason !== undefined) event.reason = v.reason;
  for (const [flag, applies] of [['reasons', type === 'unfeasibility-notified'], ['until', type === 'unfeasibility-notified' || type === 'customer-extension'], ['scope', type === 'erasure-confirmed'], ['reason', type === 'cancelled']] as const) {
    if (v[flag] !== undefined && !applies) throw new UsageError(`--${flag} does not apply to --type ${type}.`);
  }
  const next = addEvent(profile, req, event, now);
  await writeTextFile(safePath(file, 'request file'), json(next), true);
  io.out(timelineText(computeTimeline(profile, next, { now })));
  return 0;
}

async function requestCharge(io: CliIo, pos: readonly string[], v: Values): Promise<number> {
  const file = pos[0];
  if (file === undefined) throw new UsageError('Name the request file: offramp request charge <request.json> ...');
  const profile = await loadProfile(need(v.profile, 'profile'));
  const req = await loadRequest(file);
  const charge: Record<string, unknown> = {
    id: need(v.id, 'id'),
    kind: oneOfFlag(v.kind, 'kind', CHARGE_KINDS),
    amountMinor: integer(need(v.amount, 'amount'), 'amount', 0, 1_000_000_000_000),
    imposedOn: need(v['imposed-on'], 'imposed-on'),
  };
  if (v.cost !== undefined) charge.directlyLinkedCostMinor = integer(v.cost, 'cost', 0, 1_000_000_000_000);
  if (v['charge-id'] !== undefined) charge.chargeId = v['charge-id'];
  if (v.description !== undefined) charge.description = v.description;
  if (v['customer-requested'] === true) charge.customerRequested = true;
  if (v['price-agreed'] === true) charge.priceAgreedInAdvance = true;
  const next = validateRequest({ ...req, charges: [...req.charges, charge] });
  checkRequestAgainstProfile(next, profile);
  await writeTextFile(safePath(file, 'request file'), json(next), true);
  const t = computeTimeline(profile, next, { now: io.now() });
  // Report on the charge just recorded; `offramp timeline` lists the points for all charges.
  const findings = sortFindings(checkAppliedCharges(profile, next, contractLastDay(t)).filter((f) => f.subject === `charge ${String(charge.id)}`));
  io.out(findings.length === 0 ? 'Charge recorded. No points to check.\n' : `Charge recorded.\n${findingLines(findings)}\n`);
  return findings.some((f) => f.severity === 'conflict') ? 1 : 0;
}

async function requestValidate(io: CliIo, pos: readonly string[], v: Values): Promise<number> {
  const file = pos[0];
  if (file === undefined) throw new UsageError('Name the request file: offramp request validate <request.json>');
  const req = await loadRequest(file);
  if (v.profile !== undefined) checkRequestAgainstProfile(req, await loadProfile(v.profile));
  io.out(`Request ${printable(req.id, 64)} is valid${v.profile === undefined ? '' : ' and matches the profile'}.\n`);
  return 0;
}

async function requestImport(io: CliIo, pos: readonly string[], v: Values): Promise<number> {
  const file = pos[0];
  if (file === undefined) throw new UsageError('Name the export file: offramp request import <export.json>');
  const text = await readTextFile(safePath(file, 'export file'), MAX_JSON_BYTES);
  const profile = v.profile === undefined ? undefined : await loadProfile(v.profile);
  const result = importRequest(text, profile);
  for (const w of result.warnings) io.err(`Warning: ${w}\n`);
  await emit(io, json(result.request), v.out, v.force);
  return 0;
}

async function timeline(io: CliIo, pos: readonly string[], v: Values): Promise<number> {
  const file = pos[0];
  if (file === undefined) throw new UsageError('Name the request file: offramp timeline <request.json> --profile P');
  const profile = await loadProfile(need(v.profile, 'profile'));
  const req = await loadRequest(file);
  checkRequestAgainstProfile(req, profile);
  const now = v.now === undefined ? io.now() : Date.parse(parseInstant(v.now, profile.timeZone));
  const t = computeTimeline(profile, req, { now });
  const charges = checkAppliedCharges(profile, req, contractLastDay(t));
  const format = oneOfFlag(v.format, 'format', ['text', 'json'] as const, 'text');
  const all = { ...t, findings: sortFindings([...t.findings, ...charges]) };
  io.out(format === 'json' ? json({ generator: `${ATTRIBUTION.text} (${ATTRIBUTION.url})`, ...all }) : timelineText(all));
  return 0;
}

async function docs(io: CliIo, pos: readonly string[], v: Values): Promise<number> {
  const kind: DocKind = oneOfFlag(pos[0], 'kind (first argument)', DOC_KINDS);
  const format: DocFormat = oneOfFlag(v.format, 'format', DOC_FORMATS, 'md');
  const profile = await loadProfile(need(v.profile, 'profile'));
  let req: SwitchingRequest | undefined;
  if (v.request !== undefined) {
    req = await loadRequest(v.request);
    checkRequestAgainstProfile(req, profile);
  }
  const now = v.now === undefined ? io.now() : Date.parse(parseInstant(v.now, profile.timeZone));
  await emit(io, renderDocument(generateDocument(kind, profile, req, { now }), format), v.out, v.force);
  return 0;
}

async function ui(io: CliIo, v: Values): Promise<number> {
  if (io.serve === undefined) throw new UsageError('The local UI is not available here.');
  const profilePath = safePath(need(v.profile, 'profile'), '--profile');
  const profile = await loadProfile(profilePath);
  const dataDir = safePath(need(v.dir, 'dir'), '--dir');
  await io.serve({
    profilePath,
    profile,
    dataDir,
    host: v.host ?? '127.0.0.1',
    port: v.port === undefined ? 4791 : integer(v.port, 'port', 0, 65535),
    allowNonLoopback: v['allow-non-loopback'] === true,
    allowedHosts: v['allowed-host'] ?? [],
  });
  return 0;
}

/**
 * Runs the command line. Returns the exit code: 0 success, 1 findings at or above --fail-on (or a conflicting
 * charge), 2 invalid input or usage. Never throws; error messages are printable and carry no stack traces.
 */
export async function run(argv: readonly string[], io: CliIo): Promise<number> {
  try {
    let parsed;
    try {
      parsed = parseArgs({ args: [...argv], options: OPTIONS, allowPositionals: true, strict: true });
    } catch (err) {
      throw new UsageError(err instanceof Error ? err.message.split('\n')[0] ?? 'Invalid arguments.' : 'Invalid arguments.');
    }
    const { values: v, positionals } = parsed;
    if (v.version === true) {
      io.out(`${VERSION}\n`);
      return 0;
    }
    if (v.help === true || positionals.length === 0) {
      io.out(HELP);
      return positionals.length === 0 && v.help !== true ? 2 : 0;
    }
    const [cmd, sub, ...rest] = positionals;
    const name = cmd === 'profile' || cmd === 'request' ? `${cmd} ${sub ?? ''}` : (cmd ?? '');
    const allowed = ALLOWED[name];
    if (allowed === undefined) throw new UsageError(`Unknown command "${printable(name.trim(), 60)}". Run offramp --help.`);
    for (const key of Object.keys(v)) {
      if (!(allowed as readonly string[]).includes(key)) throw new UsageError(`--${key} does not apply to "${name}".`);
    }
    const pos = cmd === 'profile' || cmd === 'request' ? rest : [sub, ...rest].filter((x): x is string => x !== undefined);
    if (pos.length > 1) throw new UsageError(`Too many arguments for "${name}".`);
    switch (name) {
      case 'profile check':
        return await profileCheck(io, pos, v);
      case 'profile example':
        await emit(io, json(validateProfile(EXAMPLE_PROFILE)), v.out, v.force);
        return 0;
      case 'schema': {
        const which = oneOfFlag(pos[0], 'schema (first argument)', ['profile', 'request'] as const);
        io.out(schemaText(which));
        return 0;
      }
      case 'request create':
        if (pos.length > 0) throw new UsageError('request create takes no file argument; use --out.');
        return await requestCreate(io, v);
      case 'request event':
        return await requestEvent(io, pos, v);
      case 'request charge':
        return await requestCharge(io, pos, v);
      case 'request validate':
        return await requestValidate(io, pos, v);
      case 'request export': {
        const file = pos[0];
        if (file === undefined) throw new UsageError('Name the request file: offramp request export <request.json>');
        await emit(io, exportRequest(await loadRequest(file), io.now()), v.out, v.force);
        return 0;
      }
      case 'request import':
        return await requestImport(io, pos, v);
      case 'timeline':
        return await timeline(io, pos, v);
      case 'docs':
        return await docs(io, pos, v);
      default:
        return await ui(io, v);
    }
  } catch (err) {
    io.err(`offramp: ${printable(publicMessage(err), 2000)}\n`);
    return 2;
  }
}

