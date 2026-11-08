// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

import { randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { exportRequest } from '../connectors/exchange.ts';
import { generateDocument } from '../docs/generate.ts';
import { DOC_FORMATS, DOC_KINDS, type DocFormat, type DocKind } from '../docs/model.ts';
import { DOC_CSP, DOC_MEDIA_TYPES, renderDocument } from '../docs/render.ts';
import { addEvent, createRequest } from '../engine/lifecycle.ts';
import { computeTimeline, contractLastDay } from '../engine/timeline.ts';
import type { ProviderProfile } from '../model/profile.ts';
import { checkRequestAgainstProfile, validateRequest } from '../model/parse-request.ts';
import { CHARGE_KINDS } from '../model/profile.ts';
import { TARGET_KINDS, type SwitchingTarget } from '../model/request.ts';
import { checkAppliedCharges } from '../rules/charges.ts';
import { checkProfile } from '../rules/contract.ts';
import { dateIn, parseInstant, toIso } from '../time/zone.ts';
import { invalid, OfframpError, publicMessage } from '../util/errors.ts';
import { ID_RE } from '../util/validate.ts';
import { aboutPage, availableDocs, errorPage, homePage, layout, loginPage, newRequestPage, profilePage, requestPage, type Flash, type PageCtx } from './pages.ts';
import { RequestStore } from './store.ts';
import { APP_CSS } from './style.ts';

/**
 * Local web UI for running switching requests. Defaults: bound to 127.0.0.1, a one-time login token printed on
 * the terminal, an HttpOnly SameSite=Strict session cookie, a per-session CSRF token on every form, Host,
 * Origin and Fetch-Metadata checks, a strict CSP without any script, a body size limit, form content type only,
 * and a rate limiter per server instance.
 */

export const MAX_BODY_BYTES = 64 * 1024;
export const MAX_FORM_FIELDS = 200;
export const SESSION_IDLE_MS = 8 * 3_600_000;
export const MAX_SESSIONS = 50;
export const COOKIE = 'offramp_session';

export const UI_CSP = "default-src 'none'; style-src 'self'; img-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";

export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'content-security-policy': UI_CSP,
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  // Not 'no-referrer': with it, browsers send `Origin: null` on form POSTs and the Origin check would refuse them.
  // 'same-origin' sends the real Origin to this UI and no referrer to any other site.
  'referrer-policy': 'same-origin',
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'cache-control': 'no-store',
};

/** Rate limiter hook: return false to reject the request with 429. */
export type RateLimiter = (clientKey: string, now: number) => boolean;

/** Fixed window, `limit` requests per `windowMs` per client address. Create one per server. */
export function fixedWindowLimiter(limit = 300, windowMs = 60_000): RateLimiter {
  const hits = new Map<string, { start: number; count: number }>();
  return (key, now) => {
    const h = hits.get(key);
    if (h === undefined || now - h.start >= windowMs) {
      if (hits.size > 10_000) hits.clear();
      hits.set(key, { start: now, count: 1 });
      return true;
    }
    h.count++;
    return h.count <= limit;
  };
}

/** Constant-time string comparison (hashes first, so lengths do not leak either). */
export function constantTimeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a, 'utf8').digest();
  const hb = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(ha, hb);
}

export interface UiOptions {
  readonly profile: ProviderProfile;
  readonly dataDir: string;
  readonly host: string;
  readonly port: number;
  /** Required to bind anything other than a loopback address. */
  readonly allowNonLoopback?: boolean;
  /** Extra Host header values accepted, e.g. "offramp.internal:4791". */
  readonly allowedHosts?: readonly string[];
  readonly now?: () => number;
  readonly rateLimiter?: RateLimiter;
  /** Fixed login token (tests only). */
  readonly loginToken?: string;
}

export interface UiHandle {
  readonly server: Server;
  readonly origin: string;
  readonly loginUrl: string;
  readonly closed: Promise<void>;
  close(): Promise<void>;
}

interface Session {
  readonly csrf: string;
  lastSeen: number;
}

const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);
const UNSPECIFIED = new Set(['0.0.0.0', '::', '[::]']);
const HOST_HEADER_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?)*|\[[0-9a-f:.]{2,45}\])(?::\d{1,5})?$/u;
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/u;

function token(): string {
  return randomBytes(32).toString('base64url');
}

class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function send(res: ServerResponse, status: number, body: string, type = 'text/html; charset=utf-8', extra: Record<string, string> = {}): void {
  res.writeHead(status, { ...SECURITY_HEADERS, 'content-type': type, 'content-length': String(Buffer.byteLength(body)), ...extra });
  res.end(body);
}

function redirect(res: ServerResponse, location: string, extra: Record<string, string> = {}): void {
  res.writeHead(303, { ...SECURITY_HEADERS, location, 'content-length': '0', ...extra });
  res.end();
}

function cookieValue(header: string | undefined, name: string): string | undefined {
  if (header === undefined || header.length > 8192) return undefined;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return undefined;
}

async function readBody(req: IncomingMessage): Promise<string> {
  const len = req.headers['content-length'];
  if (len !== undefined && (!/^\d{1,9}$/u.test(len) || Number(len) > MAX_BODY_BYTES)) throw new HttpError(413, 'Request body too large.');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const b = chunk as Buffer;
    size += b.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, 'Request body too large.');
    chunks.push(b);
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
  } catch {
    throw new HttpError(400, 'The request body is not valid UTF-8.');
  }
}

type Form = Map<string, string[]>;

function parseForm(body: string): Form {
  const params = new URLSearchParams(body);
  const m: Form = new Map();
  let n = 0;
  for (const [k, v] of params) {
    if (++n > MAX_FORM_FIELDS) throw new HttpError(413, 'Too many form fields.');
    const list = m.get(k) ?? [];
    list.push(v);
    m.set(k, list);
  }
  return m;
}

function one(form: Form, key: string): string | undefined {
  const v = form.get(key)?.[0]?.trim();
  return v === undefined || v === '' ? undefined : v;
}

/** Decimal amount like "120.50" in minor units. */
function minor(v: string, what: string): number {
  if (!/^\d{1,10}(?:\.\d{1,2})?$/u.test(v)) invalid(`${what} must be an amount such as 120.50.`);
  const [whole, frac = ''] = v.split('.');
  return Number(whole) * 100 + Number(frac.padEnd(2, '0'));
}

/** Starts the UI server. Resolves once listening. */
export async function startUi(opts: UiOptions): Promise<UiHandle> {
  const host = opts.host;
  if (!LOOPBACK.has(host) && opts.allowNonLoopback !== true) {
    throw new OfframpError('USAGE', `Refusing to listen on ${host}: only loopback addresses unless --allow-non-loopback is given.`);
  }
  const extraHosts = (opts.allowedHosts ?? []).map((h) => h.toLowerCase());
  for (const h of extraHosts) {
    if (h.length > 260 || !HOST_HEADER_RE.test(h) || UNSPECIFIED.has(h.replace(/:\d+$/u, ''))) throw new OfframpError('USAGE', `Invalid allowed host "${h.slice(0, 60)}": use host or host:port.`);
  }
  if (UNSPECIFIED.has(host) && extraHosts.length === 0) throw new OfframpError('USAGE', `Listening on ${host} needs at least one --allowed-host.`);
  const profile = opts.profile;
  const store = new RequestStore(opts.dataDir);
  await store.init();
  const now = opts.now ?? Date.now;
  const limiter = opts.rateLimiter ?? fixedWindowLimiter();
  let loginToken: string | undefined = opts.loginToken ?? token();
  const sessions = new Map<string, Session>();
  let origin = '';
  let allowedHostHeaders = new Set<string>();

  const ctxFor = (s: Session): PageCtx => ({ csrf: s.csrf, profile });
  const at = (v: string | undefined, what: string): string => {
    if (v === undefined) return invalid(`Enter ${what}.`);
    const iso = parseInstant(v, profile.timeZone);
    if (Date.parse(iso) > now()) invalid(`${what[0]?.toUpperCase() ?? ''}${what.slice(1)} is in the future.`);
    return iso;
  };
  const localNow = (): string => {
    const iso = toIso(now());
    // Wall-clock "YYYY-MM-DDTHH:mm" in the profile zone, as a default for form fields.
    const day = dateIn(Date.parse(iso), profile.timeZone);
    const time = new Intl.DateTimeFormat('en-GB', { timeZone: profile.timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
    return `${day}T${time}`;
  };

  const sessionOf = (req: IncomingMessage): { id: string; s: Session } | undefined => {
    const id = cookieValue(req.headers.cookie, COOKIE);
    if (id === undefined || !TOKEN_RE.test(id)) return undefined;
    const s = sessions.get(id);
    if (s === undefined) return undefined;
    if (now() - s.lastSeen > SESSION_IDLE_MS) {
      sessions.delete(id);
      return undefined;
    }
    s.lastSeen = now();
    return { id, s };
  };

  const checkCsrf = (form: Form, s: Session): void => {
    const sent = form.get('_csrf')?.[0] ?? '';
    if (!constantTimeEqual(sent, s.csrf)) throw new HttpError(403, 'The form expired. Reload the page and try again.');
  };

  const checkOrigin = (req: IncomingMessage): void => {
    const type = (req.headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase();
    if (type !== 'application/x-www-form-urlencoded') throw new HttpError(415, 'Unsupported content type.');
    const hostHeader = (req.headers.host ?? '').toLowerCase();
    const reqOrigin = req.headers.origin;
    const sameOrigin = reqOrigin === `http://${hostHeader}` || (reqOrigin === `https://${hostHeader}` && extraHosts.includes(hostHeader));
    if (reqOrigin === undefined || !sameOrigin) throw new HttpError(403, 'Cross-origin request refused.');
    const site = req.headers['sec-fetch-site'];
    if (site !== undefined && site !== 'same-origin') throw new HttpError(403, 'Cross-site request refused.');
  };

  const requestView = async (id: string, s: Session, flash?: Flash): Promise<string> => {
    const { request, rev } = await store.get(id);
    const t = computeTimeline(profile, request, { now: now() });
    const charges = checkAppliedCharges(profile, request, contractLastDay(t));
    return layout(`Request ${request.id}`, requestPage(ctxFor(s), request, rev, t, charges, localNow()), ctxFor(s), flash);
  };

  const newId = (): string => `SR-${dateIn(now(), profile.timeZone).replaceAll('-', '')}-${randomBytes(3).toString('hex').toUpperCase()}`;

  const createFromForm = async (form: Form): Promise<string> => {
    const kind = one(form, 'target');
    if (kind === undefined || !(TARGET_KINDS as readonly string[]).includes(kind)) invalid('Choose a decision.');
    const details = one(form, 'details');
    const target: SwitchingTarget =
      kind === 'erase'
        ? { kind: 'erase' }
        : kind === 'on-premises'
          ? details === undefined ? { kind: 'on-premises' } : { kind: 'on-premises', details }
          : { kind: 'provider', providerName: one(form, 'destination') ?? invalid('Enter the destination provider.'), ...(details === undefined ? {} : { details }) };
    const categories = form.get('category') ?? [];
    const assets = form.get('asset') ?? [];
    const services = form.get('service') ?? [];
    if (services.length === 0) invalid('Choose at least one service.');
    const ref = one(form, 'customerRef');
    const email = one(form, 'customerEmail');
    const start = one(form, 'transitionStart');
    const retrieval = one(form, 'retrievalDays');
    if (retrieval !== undefined && !/^\d{1,4}$/u.test(retrieval)) invalid('The retrieval period must be a number of days.');
    const req = createRequest(profile, {
      id: one(form, 'id') ?? newId(),
      customer: { name: one(form, 'customerName') ?? invalid('Enter the customer name.'), ...(ref === undefined ? {} : { reference: ref }), ...(email === undefined ? {} : { contactEmail: email }) },
      serviceIds: services,
      target,
      ...(categories.length > 0 || assets.length > 0 ? { data: { categoryIds: categories, assetIds: assets } } : {}),
      receivedAt: at(one(form, 'receivedAt'), 'when the request was made'),
      ...(start === undefined ? {} : { transitionStartDate: start }),
      ...(retrieval === undefined ? {} : { retrievalDays: Number(retrieval) }),
    });
    await store.create(req);
    return `/requests/${req.id}`;
  };

  const addEventFromForm = async (id: string, form: Form): Promise<void> => {
    const { request } = await store.get(id);
    const rev = one(form, 'rev') ?? '';
    const type = one(form, 'type');
    const event: Record<string, unknown> = { type, at: at(one(form, 'at'), 'the time') };
    if (type === 'unfeasibility-notified') {
      event.reasons = form.get('reasons')?.[0] ?? '';
      event.alternativeTransitionEnd = one(form, 'until') ?? '';
    } else if (type === 'customer-extension') event.newTransitionEnd = one(form, 'until') ?? '';
    else if (type === 'erasure-confirmed' && one(form, 'scope') !== undefined) event.scope = form.get('scope')?.[0] ?? '';
    else if (type === 'cancelled' && one(form, 'reason') !== undefined) event.reason = form.get('reason')?.[0] ?? '';
    const next = addEvent(profile, request, event, now());
    await store.replace(next, rev);
  };

  const addChargeFromForm = async (id: string, form: Form): Promise<void> => {
    const { request } = await store.get(id);
    const rev = one(form, 'rev') ?? '';
    const kind = one(form, 'kind');
    if (kind === undefined || !(CHARGE_KINDS as readonly string[]).includes(kind)) invalid('Choose the kind of charge.');
    const cost = one(form, 'cost');
    const description = one(form, 'description');
    const charge: Record<string, unknown> = {
      id: one(form, 'chargeId') ?? invalid('Enter a charge id.'),
      kind,
      amountMinor: minor(one(form, 'amount') ?? invalid('Enter the amount.'), 'The amount'),
      imposedOn: one(form, 'imposedOn') ?? invalid('Enter the day the charge is imposed.'),
      ...(cost === undefined ? {} : { directlyLinkedCostMinor: minor(cost, 'The cost') }),
      ...(description === undefined ? {} : { description }),
      ...(one(form, 'customerRequested') === '1' ? { customerRequested: true } : {}),
      ...(one(form, 'priceAgreed') === '1' ? { priceAgreedInAdvance: true } : {}),
    };
    const next = validateRequest({ ...request, charges: [...request.charges, charge] });
    checkRequestAgainstProfile(next, profile);
    await store.replace(next, rev);
  };

  const sendDocument = (res: ServerResponse, kind: DocKind, format: DocFormat, body: string, name: string): void => {
    if (format === 'html') {
      // The document carries its own CSP; served with it and sandboxed, it can neither run script nor be framed.
      send(res, 200, body, DOC_MEDIA_TYPES.html, { 'content-security-policy': `${DOC_CSP}; frame-ancestors 'none'; sandbox` });
    } else {
      send(res, 200, body, DOC_MEDIA_TYPES[format], { 'content-disposition': `attachment; filename="${name}-${kind}.${format}"` });
    }
  };

  const docParams = (kindText: string, query: URLSearchParams): { kind: DocKind; format: DocFormat } => {
    if (!(DOC_KINDS as readonly string[]).includes(kindText)) throw new HttpError(404, 'Not found.');
    const f = query.get('format') ?? 'html';
    if (!(DOC_FORMATS as readonly string[]).includes(f)) throw new HttpError(400, 'Unknown format.');
    return { kind: kindText as DocKind, format: f as DocFormat };
  };

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const hostHeader = (req.headers.host ?? '').toLowerCase();
    if (!allowedHostHeaders.has(hostHeader)) throw new HttpError(421, 'Unknown host.');
    if (!limiter(req.socket.remoteAddress ?? 'unknown', now())) throw new HttpError(429, 'Too many requests.');
    const method = req.method ?? 'GET';
    if (method !== 'GET' && method !== 'HEAD' && method !== 'POST') throw new HttpError(405, 'Method not allowed.');
    const url = new URL(req.url ?? '/', origin);
    const path = url.pathname;

    if (path === '/static/app.css' && method !== 'POST') {
      send(res, 200, APP_CSS, 'text/css; charset=utf-8');
      return;
    }
    if (path === '/login' && method === 'GET') {
      const t = url.searchParams.get('token') ?? '';
      if (loginToken === undefined || !constantTimeEqual(t, loginToken)) {
        send(res, 403, layout('Locked', loginPage(), undefined));
        return;
      }
      loginToken = undefined; // one-time
      if (sessions.size >= MAX_SESSIONS) sessions.clear();
      const id = token();
      sessions.set(id, { csrf: token(), lastSeen: now() });
      redirect(res, '/', { 'set-cookie': `${COOKIE}=${id}; HttpOnly; SameSite=Strict; Path=/` });
      return;
    }
    const sess = sessionOf(req);
    if (sess === undefined) {
      send(res, 401, layout('Locked', loginPage(), undefined));
      return;
    }
    const s = sess.s;

    if (method === 'POST') {
      checkOrigin(req);
      const form = parseForm(await readBody(req));
      checkCsrf(form, s);
      if (path === '/logout') {
        sessions.delete(sess.id);
        redirect(res, '/login', { 'set-cookie': `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0` });
        return;
      }
      const m = /^\/requests\/([^/]{1,64})\/(events|charges)$/u.exec(path);
      try {
        if (path === '/requests') {
          redirect(res, await createFromForm(form));
          return;
        }
        if (m === null || !ID_RE.test(m[1] ?? '')) throw new HttpError(404, 'Not found.');
        const id = m[1] as string;
        if (m[2] === 'events') await addEventFromForm(id, form);
        else await addChargeFromForm(id, form);
        redirect(res, `/requests/${id}`);
      } catch (err) {
        if (err instanceof HttpError) throw err;
        if (!(err instanceof OfframpError)) throw err;
        const flash: Flash = { kind: 'bad', text: publicMessage(err) };
        if (m !== null && err.code !== 'NOT_FOUND') send(res, err.code === 'CONFLICT' ? 409 : 422, await requestView(m[1] as string, s, flash));
        else if (path === '/requests') send(res, 422, layout('New request', newRequestPage(ctxFor(s), { id: newId(), receivedAt: localNow() }), ctxFor(s), flash));
        else throw err;
      }
      return;
    }

    if (path === '/') {
      const list = await store.list();
      const rows = list.requests.map((r) => ({ request: r.request, timeline: computeTimeline(profile, r.request, { now: now() }) }));
      send(res, 200, layout('Requests', homePage(rows, list.errors), ctxFor(s)));
      return;
    }
    if (path === '/new') {
      send(res, 200, layout('New request', newRequestPage(ctxFor(s), { id: newId(), receivedAt: localNow() }), ctxFor(s)));
      return;
    }
    if (path === '/profile') {
      send(res, 200, layout('Provider profile', profilePage(ctxFor(s), checkProfile(profile)), ctxFor(s)));
      return;
    }
    if (path === '/about') {
      send(res, 200, layout('About', aboutPage(), ctxFor(s)));
      return;
    }
    const pdoc = /^\/profile\/doc\/([a-z-]{1,40})$/u.exec(path);
    if (pdoc !== null) {
      const { kind, format } = docParams(pdoc[1] as string, url.searchParams);
      if (kind !== 'information-pack') throw new HttpError(404, 'Not found.');
      sendDocument(res, kind, format, renderDocument(generateDocument(kind, profile, undefined, { now: now() }), format), 'provider');
      return;
    }
    const r = /^\/requests\/([^/]{1,64})(?:\/(export|doc\/([a-z-]{1,40})))?$/u.exec(path);
    if (r !== null) {
      const id = r[1] as string;
      if (!ID_RE.test(id)) throw new HttpError(404, 'Not found.');
      if (r[2] === undefined) {
        send(res, 200, await requestView(id, s));
        return;
      }
      const { request } = await store.get(id);
      if (r[2] === 'export') {
        send(res, 200, exportRequest(request, now()), 'application/json; charset=utf-8', { 'content-disposition': `attachment; filename="${id}.offramp.json"` });
        return;
      }
      const { kind, format } = docParams(r[3] as string, url.searchParams);
      if (!availableDocs(request).includes(kind)) throw new HttpError(404, 'This document needs an event that is not recorded yet.');
      sendDocument(res, kind, format, renderDocument(generateDocument(kind, profile, request, { now: now() }), format), id);
      return;
    }
    throw new HttpError(404, 'Not found.');
  };

  const server = createServer({ requestTimeout: 30_000, headersTimeout: 10_000, maxHeaderSize: 16 * 1024 }, (req, res) => {
    handle(req, res).catch((err: unknown) => {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      // A request refused before its body was read must not keep the connection waiting for that body.
      const extra: Record<string, string> = req.readableEnded ? {} : { connection: 'close' };
      const page = (text: string): string => layout('Error', errorPage(text), undefined);
      if (err instanceof HttpError) send(res, err.status, page(err.message), undefined, extra);
      else if (err instanceof OfframpError) send(res, err.code === 'NOT_FOUND' ? 404 : 422, page(publicMessage(err)), undefined, extra);
      else send(res, 500, page('Unexpected internal error.'), undefined, extra);
    });
  });
  server.keepAliveTimeout = 5_000;

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });
  const addr = server.address() as AddressInfo;
  const hostPart = addr.family === 'IPv6' ? `[${addr.address}]` : addr.address;
  origin = `http://${hostPart}:${addr.port}`;
  allowedHostHeaders = new Set([
    ...(UNSPECIFIED.has(host) ? [] : [`${hostPart}:${addr.port}`]),
    ...(LOOPBACK.has(host) ? [`localhost:${addr.port}`, `127.0.0.1:${addr.port}`, `[::1]:${addr.port}`] : []),
    ...extraHosts,
  ]);
  const closed = new Promise<void>((resolve) => server.once('close', () => { resolve(); }));
  const initialToken = loginToken;
  return {
    server,
    origin,
    loginUrl: `${!LOOPBACK.has(host) && extraHosts.length > 0 ? `http://${extraHosts[0] ?? ''}` : origin}/login?token=${initialToken}`,
    closed,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => { resolve(); });
        server.closeAllConnections();
      }),
  };
}
