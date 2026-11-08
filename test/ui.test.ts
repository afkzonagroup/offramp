// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { request as httpRequest, type IncomingHttpHeaders } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { constantTimeEqual, fixedWindowLimiter, MAX_BODY_BYTES, SECURITY_HEADERS, startUi, UI_CSP, type UiHandle } from '../src/ui/server.ts';
import { RequestStore } from '../src/ui/store.ts';
import { ms, profile, request } from './helpers.ts';

const TOKEN = 'T'.repeat(43);
const NOW = ms('2026-11-08T10:00:00Z');
const dirs: string[] = [];

interface Res {
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
}

function call(ui: UiHandle, method: string, path: string, opts: { headers?: Record<string, string>; body?: string | Buffer } = {}): Promise<Res> {
  const u = new URL(ui.origin);
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: u.hostname, port: u.port, method, path, headers: { host: u.host, ...opts.headers } }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => { resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }); });
    });
    req.on('error', reject);
    if (opts.body !== undefined) req.write(opts.body);
    req.end();
  });
}

function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'offramp-ui-'));
  dirs.push(d);
  return d;
}

afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

async function start(extra: Partial<Parameters<typeof startUi>[0]> = {}): Promise<{ ui: UiHandle; dir: string }> {
  const dir = join(tempDir(), 'requests');
  const ui = await startUi({ profile: profile(), dataDir: dir, host: '127.0.0.1', port: 0, loginToken: TOKEN, now: () => NOW, ...extra });
  return { ui, dir };
}

async function login(ui: UiHandle): Promise<{ cookie: string; csrf: string }> {
  const res = await call(ui, 'GET', `/login?token=${TOKEN}`);
  expect(res.status).toBe(303);
  const cookie = (res.headers['set-cookie']?.[0] ?? '').split(';')[0] ?? '';
  const page = await call(ui, 'GET', '/new', { headers: { cookie } });
  const csrf = /name="_csrf" value="([^"]+)"/.exec(page.body)?.[1] ?? '';
  expect(csrf).toMatch(/^[A-Za-z0-9_-]{43}$/);
  return { cookie, csrf };
}

function form(fields: Record<string, string | string[]>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(fields)) for (const x of Array.isArray(v) ? v : [v]) p.append(k, x);
  return p.toString();
}

function post(ui: UiHandle, path: string, s: { cookie: string; csrf: string }, fields: Record<string, string | string[]>, headers: Record<string, string> = {}): Promise<Res> {
  return call(ui, 'POST', path, {
    headers: { cookie: s.cookie, origin: ui.origin, 'content-type': 'application/x-www-form-urlencoded', 'sec-fetch-site': 'same-origin', ...headers },
    body: form({ _csrf: s.csrf, ...fields }),
  });
}

const NEW_REQUEST = { id: 'SR-UI-1', customerName: 'Acme UAB', service: 'crm', target: 'provider', destination: 'Other Cloud', receivedAt: '2026-10-30T10:00' };

describe('local UI: binding and login', () => {
  let ui: UiHandle;
  beforeEach(async () => {
    ({ ui } = await start());
  });
  afterEach(async () => {
    await ui.close();
  });

  it('listens on loopback and prints a one-time login link', () => {
    expect(ui.origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(ui.loginUrl).toBe(`${ui.origin}/login?token=${TOKEN}`);
  });

  it('locks every page until login', async () => {
    for (const path of ['/', '/new', '/profile', '/about', '/requests/SR-1', '/profile/doc/information-pack']) {
      const res = await call(ui, 'GET', path);
      expect(res.status, path).toBe(401);
      expect(res.body).toContain('Locked');
    }
  });

  it('accepts the token once and sets a strict session cookie', async () => {
    expect((await call(ui, 'GET', '/login?token=wrong')).status).toBe(403);
    expect((await call(ui, 'GET', '/login')).status).toBe(403);
    const ok = await call(ui, 'GET', `/login?token=${TOKEN}`);
    expect(ok.status).toBe(303);
    expect(ok.headers.location).toBe('/');
    const cookie = String(ok.headers['set-cookie']?.[0]);
    expect(cookie).toMatch(/^offramp_session=[A-Za-z0-9_-]{43}; HttpOnly; SameSite=Strict; Path=\/$/);
    expect((await call(ui, 'GET', `/login?token=${TOKEN}`)).status).toBe(403);
  });

  it('rejects forged or malformed session cookies', async () => {
    await login(ui);
    for (const cookie of ['offramp_session=' + 'A'.repeat(43), 'offramp_session=../../x', 'other=1', `offramp_session=${'A'.repeat(9000)}`]) {
      expect((await call(ui, 'GET', '/', { headers: { cookie } })).status).toBe(401);
    }
  });

  it('logs out with a POST and forgets the session', async () => {
    const s = await login(ui);
    const res = await post(ui, '/logout', s, {});
    expect(res.status).toBe(303);
    expect(String(res.headers['set-cookie']?.[0])).toContain('Max-Age=0');
    expect((await call(ui, 'GET', '/', { headers: { cookie: s.cookie } })).status).toBe(401);
  });

  it('refuses unknown Host headers (DNS rebinding)', async () => {
    const res = await call(ui, 'GET', `/login?token=${TOKEN}`, { headers: { host: 'evil.example:80' } });
    expect(res.status).toBe(421);
    expect((await call(ui, 'GET', '/', { headers: { host: `localhost:${new URL(ui.origin).port}` } })).status).toBe(401);
  });

  it('allows only GET, HEAD and POST', async () => {
    expect((await call(ui, 'PUT', '/')).status).toBe(405);
    expect((await call(ui, 'DELETE', '/')).status).toBe(405);
  });
});

describe('local UI: headers', () => {
  it('sends the security headers and a strict CSP with no script source', async () => {
    const { ui } = await start();
    try {
      const res = await call(ui, 'GET', '/');
      for (const [k, v] of Object.entries(SECURITY_HEADERS)) expect(res.headers[k], k).toBe(v);
      // Literal values, so removing a header from SECURITY_HEADERS fails this test.
      expect(res.headers['content-security-policy']).toBe("default-src 'none'; style-src 'self'; img-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
      expect(res.headers['x-frame-options']).toBe('DENY');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.headers['cross-origin-opener-policy']).toBe('same-origin');
      // Browsers send `Origin: null` on POSTs under 'no-referrer', which the Origin check refuses.
      expect(res.headers['referrer-policy']).toBe('same-origin');
      expect(res.body).not.toContain('no-referrer');
      expect(UI_CSP).toContain("default-src 'none'");
      expect(UI_CSP).not.toContain('script-src');
      expect(UI_CSP).not.toContain('unsafe');
      expect(res.body).not.toMatch(/<script|\sstyle=|\son\w+=/i);
      const css = await call(ui, 'GET', '/static/app.css');
      expect(css.status).toBe(200);
      expect(css.headers['content-type']).toBe('text/css; charset=utf-8');
      expect(css.body).not.toMatch(/url\(|@import/);
    } finally {
      await ui.close();
    }
  });
});

describe('local UI: state-changing requests', () => {
  let ui: UiHandle;
  let dir: string;
  let s: { cookie: string; csrf: string };
  beforeEach(async () => {
    ({ ui, dir } = await start());
    s = await login(ui);
  });
  afterEach(async () => {
    await ui.close();
  });

  it('creates a request, records events and charges, and serves documents', async () => {
    const created = await post(ui, '/requests', s, NEW_REQUEST);
    expect(created.status).toBe(303);
    expect(created.headers.location).toBe('/requests/SR-UI-1');
    const file = join(dir, 'SR-UI-1.json');
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    const page = await call(ui, 'GET', '/requests/SR-UI-1', { headers: { cookie: s.cookie } });
    expect(page.status).toBe(200);
    expect(page.body).toContain('2026-12-30');
    expect(page.body).toContain('2027-01-29');
    const rev = /name="rev" value="([0-9a-f]{64})"/.exec(page.body)?.[1] ?? '';
    const ev = await post(ui, '/requests/SR-UI-1/events', s, { rev, type: 'unfeasibility-notified', at: '2026-11-05T10:00', reasons: 'Large file store.', until: '2027-04-30' });
    expect(ev.status).toBe(303);
    const page2 = await call(ui, 'GET', '/requests/SR-UI-1', { headers: { cookie: s.cookie } });
    const rev2 = /name="rev" value="([0-9a-f]{64})"/.exec(page2.body)?.[1] ?? '';
    const ch = await post(ui, '/requests/SR-UI-1/charges', s, { rev: rev2, chargeId: 'c1', kind: 'data-egress', amount: '12.50', imposedOn: '2027-01-15' });
    expect(ch.status).toBe(303);
    const stored = JSON.parse(readFileSync(file, 'utf8')) as { events: unknown[]; charges: { amountMinor: number }[] };
    expect(stored.events).toHaveLength(1);
    expect(stored.charges[0]?.amountMinor).toBe(1250);
    const page3 = await call(ui, 'GET', '/requests/SR-UI-1', { headers: { cookie: s.cookie } });
    expect(page3.body).toContain('no switching charges may be imposed');

    const html = await call(ui, 'GET', '/requests/SR-UI-1/doc/unfeasibility-notice?format=html', { headers: { cookie: s.cookie } });
    expect(html.status).toBe(200);
    expect(html.headers['content-security-policy']).toMatch(/^default-src 'none'; style-src 'sha256-[^']+'; img-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; sandbox$/);
    const md = await call(ui, 'GET', '/requests/SR-UI-1/doc/switching-plan?format=md', { headers: { cookie: s.cookie } });
    expect(md.headers['content-disposition']).toBe('attachment; filename="SR-UI-1-switching-plan.md"');
    expect(md.headers['content-type']).toBe('text/markdown; charset=utf-8');
    const json = await call(ui, 'GET', '/requests/SR-UI-1/doc/receipt-notice?format=json', { headers: { cookie: s.cookie } });
    expect(JSON.parse(json.body)).toMatchObject({ kind: 'receipt-notice' });
    expect((await call(ui, 'GET', '/requests/SR-UI-1/doc/completion-notice', { headers: { cookie: s.cookie } })).status).toBe(404);
    expect((await call(ui, 'GET', '/requests/SR-UI-1/doc/receipt-notice?format=pdf', { headers: { cookie: s.cookie } })).status).toBe(400);
    expect((await call(ui, 'GET', '/requests/SR-UI-1/doc/nothing', { headers: { cookie: s.cookie } })).status).toBe(404);
    const exp = await call(ui, 'GET', '/requests/SR-UI-1/export', { headers: { cookie: s.cookie } });
    expect(JSON.parse(exp.body)).toMatchObject({ format: 'offramp/switching-request-export' });
    const pack = await call(ui, 'GET', '/profile/doc/information-pack?format=html', { headers: { cookie: s.cookie } });
    expect(pack.status).toBe(200);
    expect((await call(ui, 'GET', '/profile/doc/switching-plan', { headers: { cookie: s.cookie } })).status).toBe(404);
    const home = await call(ui, 'GET', '/', { headers: { cookie: s.cookie } });
    expect(home.body).toContain('SR-UI-1');
    expect((await call(ui, 'GET', '/profile', { headers: { cookie: s.cookie } })).body).toContain('not a legal assessment');
    expect((await call(ui, 'GET', '/about', { headers: { cookie: s.cookie } })).body).toContain('Offramp by AFKzona Group');
  });

  it('refuses a POST without a valid CSRF token', async () => {
    expect((await post(ui, '/requests', { ...s, csrf: 'x'.repeat(43) }, NEW_REQUEST)).status).toBe(403);
    const noToken = await call(ui, 'POST', '/requests', { headers: { cookie: s.cookie, origin: ui.origin, 'content-type': 'application/x-www-form-urlencoded' }, body: form(NEW_REQUEST) });
    expect(noToken.status).toBe(403);
    expect(readdirSync(dir)).toEqual([]);
  });

  it('refuses cross-origin and cross-site POSTs', async () => {
    expect((await post(ui, '/requests', s, NEW_REQUEST, { origin: 'http://evil.example' })).status).toBe(403);
    expect((await post(ui, '/requests', s, NEW_REQUEST, { origin: 'null' })).status).toBe(403);
    // An https origin is accepted only for an extra allowed host behind a TLS proxy, never for the plain loopback origin.
    expect((await post(ui, '/requests', s, NEW_REQUEST, { origin: ui.origin.replace('http:', 'https:') })).status).toBe(403);
    expect((await post(ui, '/requests', s, NEW_REQUEST, { 'sec-fetch-site': 'cross-site' })).status).toBe(403);
    expect((await post(ui, '/requests', s, NEW_REQUEST, { 'sec-fetch-site': 'same-site' })).status).toBe(403);
    const noOrigin = await call(ui, 'POST', '/requests', { headers: { cookie: s.cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: form({ _csrf: s.csrf, ...NEW_REQUEST }) });
    expect(noOrigin.status).toBe(403);
    expect(readdirSync(dir)).toEqual([]);
  });

  it('accepts only form-encoded bodies within the size and field limits', async () => {
    expect((await post(ui, '/requests', s, NEW_REQUEST, { 'content-type': 'application/json' })).status).toBe(415);
    expect((await post(ui, '/requests', s, NEW_REQUEST, { 'content-type': 'text/plain' })).status).toBe(415);
    expect((await post(ui, '/requests', s, { ...NEW_REQUEST, notes: 'x'.repeat(MAX_BODY_BYTES) })).status).toBe(413);
    expect((await post(ui, '/requests', s, NEW_REQUEST, { 'content-length': '99999999999' })).status).toBe(413);
    const many: Record<string, string> = {};
    for (let i = 0; i < 250; i++) many[`f${i}`] = 'x';
    expect((await post(ui, '/requests', s, { ...NEW_REQUEST, ...many })).status).toBe(413);
    // Invalid UTF-8 (0xff 0xfe) after a valid CSRF token is refused as such, not decoded with replacement characters.
    const bad = await call(ui, 'POST', '/requests', { headers: { cookie: s.cookie, origin: ui.origin, 'content-type': 'application/x-www-form-urlencoded' }, body: Buffer.concat([Buffer.from(`${form({ _csrf: s.csrf, ...NEW_REQUEST })}&notes=`), Buffer.from([0xff, 0xfe])]) });
    expect(bad.status).toBe(400);
    expect(bad.body).toContain('not valid UTF-8');
    expect(readdirSync(dir)).toEqual([]);
  });

  it('shows validation errors without stack traces and keeps the folder clean', async () => {
    const res = await post(ui, '/requests', s, { ...NEW_REQUEST, id: '../../etc/passwd' });
    expect(res.status).toBe(422);
    expect(res.body).toContain('identifier');
    expect(res.body).not.toMatch(/at \w+ \(|node:internal|\.ts:\d+/);
    expect((await post(ui, '/requests', s, { ...NEW_REQUEST, receivedAt: '2027-01-01T10:00' })).body).toContain('in the future');
    expect((await post(ui, '/requests', s, { ...NEW_REQUEST, service: [] })).body).toContain('Choose at least one service');
    expect((await post(ui, '/requests', s, { ...NEW_REQUEST, target: 'nowhere' })).body).toContain('Choose a decision');
    expect((await post(ui, '/requests', s, { ...NEW_REQUEST, destination: '' })).body).toContain('destination provider');
    expect(readdirSync(dir)).toEqual([]);
  });

  it('keeps each finding in one grid cell on phones, and lets row labels wrap', async () => {
    const page = await call(ui, 'GET', '/profile', { headers: { cookie: s.cookie } });
    // On narrow screens a cell is a two-column grid (label, value): the value must be a single element.
    expect(page.body).toMatch(/<td data-label="Point"><span>/);
    expect(page.body).not.toMatch(/<td data-label="Point"><span class="muted">/);
    const css = await call(ui, 'GET', '/static/app.css');
    expect(css.body).toMatch(/table\.rows td::before\{[^}]*white-space:normal/);
  });

  it('escapes user data in pages', async () => {
    await post(ui, '/requests', s, { ...NEW_REQUEST, customerName: '<script>alert(1)</script>', destination: '"><img src=x onerror=alert(1)>' });
    const page = await call(ui, 'GET', '/requests/SR-UI-1', { headers: { cookie: s.cookie } });
    expect(page.body).not.toMatch(/<script>alert|<img src/);
    expect(page.body).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    const home = await call(ui, 'GET', '/', { headers: { cookie: s.cookie } });
    expect(home.body).not.toMatch(/<script>alert/);
  });

  it('refuses a stale form when the request changed meanwhile', async () => {
    await post(ui, '/requests', s, NEW_REQUEST);
    const page = await call(ui, 'GET', '/requests/SR-UI-1', { headers: { cookie: s.cookie } });
    const rev = /name="rev" value="([0-9a-f]{64})"/.exec(page.body)?.[1] ?? '';
    expect((await post(ui, '/requests/SR-UI-1/events', s, { rev, type: 'transition-started', at: '2026-11-01T10:00' })).status).toBe(303);
    const stale = await post(ui, '/requests/SR-UI-1/events', s, { rev, type: 'cancelled', at: '2026-11-02T10:00' });
    expect(stale.status).toBe(409);
    expect(stale.body).toContain('changed elsewhere');
  });

  it('reports lifecycle conflicts on the request page', async () => {
    await post(ui, '/requests', s, NEW_REQUEST);
    const page = await call(ui, 'GET', '/requests/SR-UI-1', { headers: { cookie: s.cookie } });
    const rev = /name="rev" value="([0-9a-f]{64})"/.exec(page.body)?.[1] ?? '';
    const res = await post(ui, '/requests/SR-UI-1/events', s, { rev, type: 'unfeasibility-notified', at: '2026-11-05T10:00', reasons: 'r', until: '2027-12-31' });
    expect(res.status).toBe(409);
    expect(res.body).toContain('must not exceed 7 months');
    const charge = await post(ui, '/requests/SR-UI-1/charges', s, { rev, chargeId: 'c1', kind: 'data-egress', amount: '12.505', imposedOn: '2027-01-15' });
    expect(charge.status).toBe(422);
    expect(charge.body).toContain('amount such as');
  });

  it('never maps request ids to paths outside the folder', async () => {
    for (const path of ['/requests/..%2F..%2Fetc%2Fpasswd', '/requests/.hidden', '/requests/a%00b', '/requests/%2e%2e%2fx']) {
      const res = await call(ui, 'GET', path, { headers: { cookie: s.cookie } });
      expect(res.status, path).toBe(404);
    }
    expect((await post(ui, '/requests/..%2Fx/events', s, { type: 'cancelled', at: '2026-11-01T10:00' })).status).toBe(404);
    expect((await post(ui, '/requests/NOPE/events', s, { type: 'cancelled', at: '2026-11-01T10:00' })).status).toBe(404);
    expect((await call(ui, 'GET', '/requests/NOPE', { headers: { cookie: s.cookie } })).status).toBe(404);
  });

  it('lists unreadable files without failing and refuses symbolic links', async () => {
    writeFileSync(join(dir, 'BROKEN.json'), '{nope');
    const outside = join(tempDir(), 'secret.json');
    writeFileSync(outside, JSON.stringify(request({ id: 'LINKED' })));
    symlinkSync(outside, join(dir, 'LINKED.json'));
    const home = await call(ui, 'GET', '/', { headers: { cookie: s.cookie } });
    expect(home.status).toBe(200);
    expect(home.body).toContain('BROKEN.json');
    expect(home.body).toContain('symbolic link');
    expect((await call(ui, 'GET', '/requests/LINKED', { headers: { cookie: s.cookie } })).status).toBe(422);
  });
});

describe('local UI: rate limiting and configuration', () => {
  it('rejects requests over the limit with 429, per server instance', async () => {
    const { ui } = await start({ rateLimiter: fixedWindowLimiter(3, 60_000) });
    const { ui: other } = await start();
    try {
      const codes = [];
      for (let i = 0; i < 5; i++) codes.push((await call(ui, 'GET', '/')).status);
      expect(codes).toEqual([401, 401, 401, 429, 429]);
      expect((await call(other, 'GET', '/')).status).toBe(401);
    } finally {
      await ui.close();
      await other.close();
    }
  });

  it('starts a new window after the window passes', () => {
    const lim = fixedWindowLimiter(1, 1000);
    expect(lim('a', 0)).toBe(true);
    expect(lim('a', 10)).toBe(false);
    expect(lim('b', 10)).toBe(true);
    expect(lim('a', 1000)).toBe(true);
  });

  it('refuses non-loopback addresses unless allowed, and checks allowed hosts', async () => {
    const dir = tempDir();
    await expect(startUi({ profile: profile(), dataDir: dir, host: '0.0.0.0', port: 0 })).rejects.toThrow(/only loopback/);
    await expect(startUi({ profile: profile(), dataDir: dir, host: '0.0.0.0', port: 0, allowNonLoopback: true })).rejects.toThrow(/allowed-host/);
    await expect(startUi({ profile: profile(), dataDir: dir, host: '127.0.0.1', port: 0, allowedHosts: ['bad host'] })).rejects.toThrow(/Invalid allowed host/);
    await expect(startUi({ profile: profile(), dataDir: dir, host: '127.0.0.1', port: 0, allowedHosts: ['0.0.0.0:80'] })).rejects.toThrow(/Invalid allowed host/);
    const ui = await startUi({ profile: profile(), dataDir: dir, host: '127.0.0.1', port: 0, allowedHosts: ['offramp.internal:8080'], loginToken: TOKEN });
    try {
      expect((await call(ui, 'GET', '/', { headers: { host: 'offramp.internal:8080' } })).status).toBe(401);
      expect(ui.loginUrl).toContain('127.0.0.1');
    } finally {
      await ui.close();
    }
  });

  it('expires idle sessions', async () => {
    let now = NOW;
    const { ui } = await start({ now: () => now });
    try {
      const s = await login(ui);
      now += 8 * 3_600_000 + 1;
      expect((await call(ui, 'GET', '/', { headers: { cookie: s.cookie } })).status).toBe(401);
    } finally {
      await ui.close();
    }
  });

  it('compares tokens in constant time over hashes', () => {
    expect(constantTimeEqual('abc', 'abc')).toBe(true);
    expect(constantTimeEqual('abc', 'abd')).toBe(false);
    expect(constantTimeEqual('abc', 'abcd')).toBe(false);
    expect(constantTimeEqual('', '')).toBe(true);
  });
});

describe('request store', () => {
  it('creates exclusively and refuses bad ids', async () => {
    const st = new RequestStore(join(tempDir(), 'r'));
    await st.init();
    await st.create(request({ id: 'A' }));
    await expect(st.create(request({ id: 'A' }))).rejects.toThrow(/already exists/);
    await expect(st.get('../A')).rejects.toThrow(/Invalid request id/);
    const listing = await st.list();
    expect(listing.requests.map((r) => r.request.id)).toEqual(['A']);
  });

  it('detects a file whose content names another request', async () => {
    const dir = join(tempDir(), 'r');
    const st = new RequestStore(dir);
    await st.init();
    writeFileSync(join(dir, 'B.json'), JSON.stringify(request({ id: 'C' })));
    await expect(st.get('B')).rejects.toThrow(/contains request C/);
  });

  it('refuses a data folder that is a symbolic link or a file', async () => {
    const base = tempDir();
    writeFileSync(join(base, 'file'), 'x');
    await expect(new RequestStore(join(base, 'file')).init()).rejects.toThrow();
    symlinkSync(tempDir(), join(base, 'link'));
    await expect(new RequestStore(join(base, 'link')).init()).rejects.toThrow(/not a directory/);
  });
});
