// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

import { mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { githubOutputLines, HELP, run, type CliIo } from '../src/cli/run.ts';
import { EXAMPLE_PROFILE } from '../src/example.ts';
import { readTextFile, writeTextFile } from '../src/io/files.ts';
import { VERSION } from '../src/version.ts';
import { clone, ms, patch } from './helpers.ts';

const NOW = ms('2026-11-08T10:00:00Z');
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

interface Result {
  code: number;
  out: string;
  err: string;
}

let dir = '';
let env: Record<string, string> = {};
let served: unknown[] = [];

function io(): CliIo & { o: string[]; e: string[] } {
  const o: string[] = [];
  const e: string[] = [];
  return {
    o,
    e,
    out: (t) => o.push(t),
    err: (t) => e.push(t),
    env: (n) => env[n],
    now: () => NOW,
    serve: (opts) => {
      served.push(opts);
      return Promise.resolve();
    },
  };
}

async function cli(...args: string[]): Promise<Result> {
  const x = io();
  const code = await run(args, x);
  return { code, out: x.o.join(''), err: x.e.join('') };
}

function file(name: string): string {
  return join(dir, name);
}

function writeProfile(changes: Record<string, unknown> = {}, name = 'p.json'): string {
  const p: unknown = clone(EXAMPLE_PROFILE);
  patch(p, changes);
  writeFileSync(file(name), JSON.stringify(p));
  return file(name);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'offramp-cli-'));
  dirs.push(dir);
  env = {};
  served = [];
});

async function createRequest(extra: string[] = []): Promise<string> {
  const p = writeProfile();
  const r = await cli('request', 'create', '--profile', p, '--id', 'SR-1', '--customer', 'Acme UAB', '--service', 'crm', '--target', 'provider', '--destination', 'Other Cloud', '--received-at', '2026-10-30T10:00', '--out', file('r.json'), ...extra);
  expect(r.code, r.err).toBe(0);
  return file('r.json');
}

describe('help and usage', () => {
  it('prints help, version and attribution', async () => {
    const h = await cli('--help');
    expect(h.code).toBe(0);
    expect(h.out).toBe(HELP);
    expect(h.out).toContain('Offramp by AFKzona Group - https://afkzonagroup.lt');
    expect(h.out).toContain('not legal advice');
    expect((await cli('--version')).out).toBe(`${VERSION}\n`);
    expect((await cli()).code).toBe(2);
  });

  it('rejects unknown commands, unknown flags and flags of other commands', async () => {
    expect((await cli('frobnicate')).err).toContain('Unknown command');
    expect((await cli('profile', 'nope')).code).toBe(2);
    expect((await cli('profile', 'check', 'x.json', '--bogus')).err).toContain("Unknown option '--bogus'");
    const wrong = await cli('profile', 'check', 'x.json', '--customer', 'x');
    expect(wrong.code).toBe(2);
    expect(wrong.err).toContain('--customer does not apply to "profile check"');
    expect((await cli('timeline', 'a.json', 'b.json', '--profile', 'p')).err).toContain('Too many arguments');
  });

  it('prints errors without stack traces and makes them printable', async () => {
    const r = await cli('profile', 'check', file('missing\u001b[31m.json'));
    expect(r.code).toBe(2);
    expect(r.err).toBe('offramp: missing\\u{1b}[31m.json does not exist.\n');
    // Messages from Node's argument parser are not escaped at the source; the CLI escapes everything it prints.
    const opt = await cli('--evil\u001b]0;title\u0007');
    expect(opt.err.includes('\u001b') || opt.err.includes('\u0007')).toBe(false);
    expect(opt.err).toContain('\\u{1b}');
  });
});

describe('profile commands', () => {
  it('writes the example profile and checks it', async () => {
    expect((await cli('profile', 'example', '--out', file('ex.json'))).code).toBe(0);
    expect(statSync(file('ex.json')).mode & 0o777).toBe(0o600);
    const r = await cli('profile', 'check', file('ex.json'));
    expect(r.code).toBe(0);
    expect(r.out).toContain('Provider profile: Example Cloud');
    expect(r.out).toContain('0 conflict(s), 0 missing item(s), 1 item(s) to review');
    expect(r.out).toContain('Offramp by AFKzona Group');
    expect((await cli('profile', 'example')).out).toContain('"format": "offramp/provider-profile"');
  });

  it('applies --fail-on levels', async () => {
    const p = writeProfile({ 'contract.transitionDays': 31 });
    expect((await cli('profile', 'check', p)).code).toBe(1);
    expect((await cli('profile', 'check', p, '--fail-on', 'never')).code).toBe(0);
    const ok = writeProfile();
    expect((await cli('profile', 'check', ok, '--fail-on', 'conflict')).code).toBe(0);
    expect((await cli('profile', 'check', ok, '--fail-on', 'missing')).code).toBe(0);
    expect((await cli('profile', 'check', ok, '--fail-on', 'review')).code).toBe(1);
    expect((await cli('profile', 'check', ok, '--fail-on', 'everything')).code).toBe(2);
  });

  it('prints JSON reports with the generator attribution', async () => {
    const r = await cli('profile', 'check', writeProfile(), '--format', 'json');
    const report = JSON.parse(r.out) as { generator: string; counts: Record<string, number>; summary: string };
    expect(report.generator).toBe('Offramp by AFKzona Group (https://afkzonagroup.lt)');
    expect(report.counts.conflict).toBe(0);
    expect(report.summary).toMatch(/not a legal assessment/);
  });

  it('writes only integer counts to $GITHUB_OUTPUT', async () => {
    env.GITHUB_OUTPUT = file('gh-out');
    writeFileSync(env.GITHUB_OUTPUT, 'earlier=1\n');
    const r = await cli('profile', 'check', writeProfile({ 'provider.name': 'Evil\nfindings=999' }, 'evil.json'), '--github-output');
    // The newline in the name is rejected by validation before anything is written.
    expect(r.code).toBe(2);
    expect(readFileSync(env.GITHUB_OUTPUT, 'utf8')).toBe('earlier=1\n');
    expect((await cli('profile', 'check', writeProfile({ 'contract.transitionDays': 31 }), '--github-output')).code).toBe(1);
    expect(readFileSync(env.GITHUB_OUTPUT, 'utf8')).toBe('earlier=1\nconflicts=1\nmissing=0\nreview=1\nfindings=2\n');
    env = {};
    expect((await cli('profile', 'check', writeProfile(), '--github-output')).err).toContain('needs the GITHUB_OUTPUT');
    expect(githubOutputLines({ conflict: 1, missing: 2, review: 3, info: 9 })).toEqual(['conflicts=1', 'missing=2', 'review=3', 'findings=6']);
    expect(() => githubOutputLines({ conflict: Number.NaN, missing: 0, review: 0, info: 0 })).toThrow(/unexpected output/);
    expect(() => githubOutputLines({ conflict: -1, missing: 0, review: 0, info: 0 })).toThrow(/unexpected output/);
  });

  it('reports invalid profiles with the JSON path', async () => {
    const r = await cli('profile', 'check', writeProfile({ 'contract.noticePeriod': { unit: 'weeks', value: 1 } }));
    expect(r.code).toBe(2);
    expect(r.err).toContain('$.contract.noticePeriod.unit: must be one of: days, months.');
    writeFileSync(file('bad.json'), '{"__proto__": {}}');
    expect((await cli('profile', 'check', file('bad.json'))).err).toContain('forbidden key');
    writeFileSync(file('latin1.json'), Buffer.from([0x7b, 0xff, 0x7d]));
    expect((await cli('profile', 'check', file('latin1.json'))).err).toContain('not valid UTF-8');
    writeFileSync(file('huge.json'), `"${'a'.repeat(1024 * 1024 + 1)}"`);
    expect((await cli('profile', 'check', file('huge.json'))).err).toContain('larger than');
  });

  it('refuses to read through a symbolic link or a directory', async () => {
    const p = writeProfile();
    symlinkSync(p, file('link.json'));
    expect((await cli('profile', 'check', file('link.json'))).err).toContain('symbolic link');
    expect((await cli('profile', 'check', dir)).err).toContain('not a regular file');
    expect((await cli('profile', 'check', 'a\0b')).err).toContain('invalid path');
  });

  it('prints the schemas', async () => {
    expect(JSON.parse((await cli('schema', 'profile')).out)).toMatchObject({ title: 'Offramp provider profile' });
    expect(JSON.parse((await cli('schema', 'request')).out)).toMatchObject({ title: 'Offramp switching request' });
    expect((await cli('schema', 'other')).code).toBe(2);
  });
});

describe('request commands', () => {
  it('creates a request and refuses to overwrite without --force', async () => {
    const r = await createRequest();
    const req = JSON.parse(readFileSync(r, 'utf8')) as { receivedAt: string; data: { categoryIds: string[] } };
    expect(req.receivedAt).toBe('2026-10-30T08:00:00.000Z');
    expect(req.data.categoryIds).toHaveLength(4);
    const again = await cli('request', 'create', '--profile', file('p.json'), '--id', 'SR-1', '--customer', 'X', '--service', 'crm', '--target', 'erase', '--out', r);
    expect(again.err).toContain('already exists');
    expect((await cli('request', 'create', '--profile', file('p.json'), '--id', 'SR-1', '--customer', 'X', '--service', 'crm', '--target', 'erase', '--out', r, '--force')).code).toBe(0);
    expect(statSync(r).mode & 0o777).toBe(0o600);
  });

  it('does not write through a symbolic link at the output path', async () => {
    const p = writeProfile();
    const target = file('target.txt');
    writeFileSync(target, 'keep');
    symlinkSync(target, file('out.json'));
    const args = ['request', 'create', '--profile', p, '--id', 'SR-1', '--customer', 'X', '--service', 'crm', '--target', 'erase', '--received-at', '2026-10-30', '--out', file('out.json')];
    expect((await cli(...args)).code).toBe(2);
    expect(readFileSync(target, 'utf8')).toBe('keep');
    expect((await cli(...args, '--force')).code).toBe(0);
    expect(readFileSync(target, 'utf8')).toBe('keep');
  });

  it('validates create options', async () => {
    const p = writeProfile();
    const base = ['request', 'create', '--profile', p, '--id', 'SR-2', '--customer', 'X', '--service', 'crm'];
    expect((await cli(...base, '--target', 'provider')).err).toContain('Missing --destination');
    expect((await cli(...base, '--target', 'erase', '--destination', 'Y')).err).toContain('do not apply');
    expect((await cli(...base, '--target', 'on-premises', '--destination', 'Y')).err).toContain('provider only');
    expect((await cli(...base, '--target', 'moon')).err).toContain('--target must be one of');
    expect((await cli(...base, '--target', 'erase', '--received-at', '2027-01-01')).err).toContain('future');
    expect((await cli(...base, '--target', 'erase', '--received-at', '2026-03-29T03:30')).err).toContain('does not exist');
    expect((await cli(...base, '--target', 'on-premises', '--data', 'crm-records,bad id')).err).toContain('not a valid identifier');
    expect((await cli(...base, '--target', 'on-premises', '--retrieval-days=-5')).err).toContain('whole number');
    expect((await cli(...base, '--target', 'on-premises', '--retrieval-days', '99999')).err).toContain('between 1 and 3650');
    expect((await cli('request', 'create', '--profile', p, 'extra')).err).toContain('takes no file argument');
    const ok = await cli(...base, '--target', 'on-premises', '--details', 'Our DC', '--data', 'crm-records', '--assets', 'crm-roles', '--customer-ref', 'C1', '--customer-email', 'a@b.example', '--transition-start', '2027-01-04', '--retrieval-days', '60');
    expect(ok.code, ok.err).toBe(0);
    expect(JSON.parse(ok.out)).toMatchObject({ target: { kind: 'on-premises', details: 'Our DC' }, data: { categoryIds: ['crm-records'], assetIds: ['crm-roles'] }, retrievalDays: 60 });
  });

  it('records events and prints the timeline', async () => {
    const r = await createRequest();
    const p = file('p.json');
    const ev = await cli('request', 'event', r, '--profile', p, '--type', 'unfeasibility-notified', '--at', '2026-11-05T10:00', '--reasons', 'Volume', '--until', '2027-04-30');
    expect(ev.code, ev.err).toBe(0);
    expect(ev.out).toContain('2027-04-30');
    expect((await cli('request', 'event', r, '--profile', p, '--type', 'customer-extension', '--at', '2026-11-06', '--until', '2027-05-31')).code).toBe(0);
    expect((await cli('request', 'event', r, '--profile', p, '--type', 'transition-started', '--at', '2026-11-07', '--note', 'n')).code).toBe(0);
    const bad = await cli('request', 'event', r, '--profile', p, '--type', 'transition-started', '--reasons', 'x');
    expect(bad.err).toContain('--reasons does not apply');
    expect((await cli('request', 'event', r, '--profile', p, '--type', 'transition-started')).err).toContain('once');
    expect((await cli('request', 'event', r, '--profile', p, '--type', 'cancelled', '--reason', 'Stays')).code).toBe(0);
    expect((await cli('request', 'event', r, '--profile', p, '--type', 'erasure-confirmed', '--scope', 'x')).err).toContain('cancelled');
    const stored = JSON.parse(readFileSync(r, 'utf8')) as { events: { type: string }[] };
    expect(stored.events.map((e) => e.type)).toEqual(['unfeasibility-notified', 'customer-extension', 'transition-started', 'cancelled']);
    expect((await cli('request', 'event', '--profile', p, '--type', 'cancelled')).err).toContain('Name the request file');
  });

  it('records charges and flags those after 12 January 2027', async () => {
    const r = await createRequest();
    const p = file('p.json');
    const late = await cli('request', 'charge', r, '--profile', p, '--id', 'c1', '--kind', 'data-egress', '--amount', '5000', '--imposed-on', '2027-01-12', '--charge-id', 'egress');
    expect(late.code).toBe(1);
    expect(late.out).toContain('From 2027-01-12 no switching charges may be imposed');
    const fine = await cli('request', 'charge', r, '--profile', p, '--id', 'c2', '--kind', 'additional-service', '--amount', '9000', '--imposed-on', '2026-12-01', '--customer-requested', '--price-agreed', '--description', 'Help', '--cost', '1');
    expect(fine.code).toBe(0);
    expect((await cli('request', 'charge', r, '--profile', p, '--id', 'c3', '--kind', 'switching', '--amount', '1', '--imposed-on', '2026-12-01', '--charge-id', 'egress')).err).toContain('differs');
    expect((await cli('request', 'charge', r, '--profile', p, '--id', 'c1', '--kind', 'switching', '--amount', '1', '--imposed-on', '2026-12-01')).err).toContain('duplicate');
    expect((await cli('request', 'charge', r, '--profile', p, '--id', 'c4', '--kind', 'switching', '--amount', '1.5', '--imposed-on', '2026-12-01')).err).toContain('whole number');
  });

  it('validates, exports and imports requests', async () => {
    const r = await createRequest();
    expect((await cli('request', 'validate', r)).out).toContain('is valid.');
    expect((await cli('request', 'validate', r, '--profile', file('p.json'))).out).toContain('matches the profile');
    expect((await cli('request', 'export', r, '--out', file('x.json'))).code).toBe(0);
    const imp = await cli('request', 'import', file('x.json'), '--profile', file('p.json'));
    expect(imp.code, imp.err).toBe(0);
    expect(JSON.parse(imp.out)).toMatchObject({ id: 'SR-1' });
    writeProfile({ 'contract.retrievalDays': 60 });
    expect((await cli('request', 'import', file('x.json'), '--profile', file('p.json'))).err).toContain('Warning: The provider profile has changed');
    writeFileSync(file('x.json'), readFileSync(file('x.json'), 'utf8').replace('Acme UAB', 'Mallory'));
    expect((await cli('request', 'import', file('x.json'))).err).toContain('changed or is incomplete');
    for (const sub of ['validate', 'export', 'import']) expect((await cli('request', sub)).err).toContain('Name the');
  });

  it('prints the timeline as text or JSON for a chosen moment', async () => {
    const r = await createRequest();
    const t = await cli('timeline', r, '--profile', file('p.json'), '--now', '2027-01-15');
    expect(t.out).toContain('Request SR-1: transition');
    expect(t.out).toContain('2027-01-29  upcoming');
    const j = JSON.parse((await cli('timeline', r, '--profile', file('p.json'), '--format', 'json')).out) as { state: string; generator: string };
    expect(j.state).toBe('notice');
    expect(j.generator).toContain('AFKzona Group');
    expect((await cli('timeline', '--profile', file('p.json'))).err).toContain('Name the request file');
  });
});

describe('documents', () => {
  it('writes every document kind in every format', async () => {
    const r = await createRequest();
    const p = file('p.json');
    await cli('request', 'event', r, '--profile', p, '--type', 'unfeasibility-notified', '--at', '2026-11-05T10:00', '--reasons', 'Volume', '--until', '2027-04-30');
    await cli('request', 'event', r, '--profile', p, '--type', 'customer-extension', '--at', '2026-11-06', '--until', '2027-05-31');
    for (const kind of ['information-pack', 'switching-plan', 'receipt-notice', 'unfeasibility-notice', 'extension-confirmation']) {
      for (const format of ['md', 'html', 'json']) {
        const res = await cli('docs', kind, '--profile', p, '--request', r, '--format', format, '--now', '2026-11-08');
        expect(res.code, `${kind} ${format} ${res.err}`).toBe(0);
        expect(res.out).toContain('Offramp by AFKzona Group');
      }
    }
    expect((await cli('docs', 'completion-notice', '--profile', p, '--request', r)).err).toContain('Record "switching-completed"');
    expect((await cli('docs', 'switching-plan', '--profile', p)).err).toContain('needs a switching request');
    expect((await cli('docs', 'brochure', '--profile', p)).err).toContain('must be one of');
    expect((await cli('docs', 'information-pack', '--profile', p, '--format', 'pdf')).err).toContain('--format must be one of');
    expect((await cli('docs', 'information-pack', '--profile', p, '--out', file('pack.html'), '--format', 'html')).code).toBe(0);
    expect(readFileSync(file('pack.html'), 'utf8')).toContain('<!doctype html>');
  });
});

describe('file helpers', () => {
  it('caps the size of files read, independently of the JSON parser', async () => {
    writeFileSync(file('small.txt'), 'x'.repeat(20));
    await expect(readTextFile(file('small.txt'), 10)).rejects.toThrow('small.txt is larger than 10 bytes.');
    await expect(readTextFile(file('small.txt'), 20)).resolves.toBe('x'.repeat(20));
  });

  it('refuses a huge file from its size before reading it into memory', async () => {
    // A sparse 3 GiB file takes no disk space. Without the size check before reading, Node would try to read it.
    const huge = file('huge.json');
    writeFileSync(huge, '');
    truncateSync(huge, 3 * 1024 ** 3);
    await expect(readTextFile(huge, 1024)).rejects.toThrow('huge.json is larger than 1024 bytes.');
    rmSync(huge);
  });

  it('replaces files atomically with mode 0600', async () => {
    await writeTextFile(file('a.txt'), 'one', false);
    await writeTextFile(file('a.txt'), 'two', true);
    expect(readFileSync(file('a.txt'), 'utf8')).toBe('two');
    expect(statSync(file('a.txt')).mode & 0o777).toBe(0o600);
    await expect(writeTextFile(join(file('missing'), 'a.txt'), 'x', true)).rejects.toThrow(/Could not write|does not exist/);
  });
});

describe('ui command', () => {
  it('passes validated options to the server', async () => {
    const p = writeProfile();
    expect((await cli('ui', '--profile', p, '--dir', file('data'), '--port', '0', '--allowed-host', 'a.example:1', '--allowed-host', 'b.example')).code).toBe(0);
    expect(served[0]).toMatchObject({ host: '127.0.0.1', port: 0, dataDir: file('data'), allowNonLoopback: false, allowedHosts: ['a.example:1', 'b.example'] });
    expect((await cli('ui', '--profile', p, '--dir', file('data'), '--port', '70000')).err).toContain('between 0 and 65535');
    expect((await cli('ui', '--profile', p)).err).toContain('Missing --dir');
    const x = io();
    delete x.serve;
    expect(await run(['ui', '--profile', p, '--dir', file('d')], x)).toBe(2);
  });
});
