// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

// Repository-wide checks: dangerous APIs, network code, hidden characters, licence headers, package hygiene,
// the GitHub Action and the workflows.

import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { VERSION } from '../src/version.ts';

const ROOT = join(import.meta.dirname, '..');

function files(dir: string, ext: RegExp): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if ((name.startsWith('.') && name !== '.github') || ['node_modules', 'dist', 'dist-typecheck', 'coverage'].includes(name)) continue;
    const p = join(dir, name);
    const info = lstatSync(p);
    if (info.isDirectory()) out.push(...files(p, ext));
    else if (info.isFile() && ext.test(name)) out.push(p);
  }
  return out;
}

const SOURCES = files(join(ROOT, 'src'), /\.ts$/);
const ALL_CODE = [...SOURCES, ...files(join(ROOT, 'test'), /\.ts$/), ...files(join(ROOT, 'scripts'), /\.(ts|mjs)$/)];
const rel = (f: string): string => relative(ROOT, f);

describe('source hygiene', () => {
  it('uses no eval, Function constructor, dynamic import, child processes or HTML sinks', () => {
    const forbidden = [/\beval\s*\(/, /new\s+Function\s*\(/, /\bimport\s*\(/, /child_process/, /\.innerHTML\b/, /\.outerHTML\b/, /insertAdjacentHTML/, /document\.write/];
    for (const file of SOURCES) {
      const text = readFileSync(file, 'utf8');
      for (const re of forbidden) expect(re.test(text), `${rel(file)} matches ${re}`).toBe(false);
    }
  });

  it('has no network code outside the local UI server, which only listens', () => {
    const network = [/\bfetch\s*\(/, /XMLHttpRequest/, /WebSocket/, /node:https/, /node:dgram/, /node:tls/, /node:child_process/, /node:worker_threads/, /\brequire\s*\(/, /process\.binding/, /\.request\s*\(/, /\bconnect\s*\(/];
    for (const file of SOURCES) {
      const text = readFileSync(file, 'utf8');
      for (const re of network) expect(re.test(text), `${rel(file)} matches ${re}`).toBe(false);
      const usesHttp = /from 'node:(http|net)'/.test(text);
      expect(usesHttp && !file.endsWith(join('src', 'ui', 'server.ts')), `${rel(file)} imports node:http or node:net`).toBe(false);
    }
  });

  it('has no raw bidirectional, zero-width, control or separator characters in any text file', () => {
    const text = [...ALL_CODE, ...files(ROOT, /\.(md|json|ya?ml|html|css|txt)$/)];
    for (const extra of ['.gitignore', '.npmrc', '.editorconfig', 'LICENSE']) text.push(join(ROOT, extra));
    expect(text.length).toBeGreaterThan(30);
    // eslint-disable-next-line no-control-regex -- detecting control characters is the purpose of this test
    const forbidden = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u00a0\u061c\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]/;
    for (const file of text) expect(forbidden.test(readFileSync(file, 'utf8')), rel(file)).toBe(false);
  });

  it('names no AI tool or vendor in any file', () => {
    // The words are assembled at run time so this file does not contain them.
    const words = [[99, 108, 97, 117, 100, 101], [97, 110, 116, 104, 114, 111, 112, 105, 99]].map((w) => String.fromCharCode(...w));
    const all = [...ALL_CODE, ...files(ROOT, /\.(md|json|ya?ml|html|css|txt|js)$/)];
    for (const extra of ['.gitignore', '.npmrc', '.editorconfig', 'LICENSE']) all.push(join(ROOT, extra));
    for (const file of all) {
      const text = readFileSync(file, 'utf8').toLowerCase();
      for (const w of words) expect(text.includes(w), `${rel(file)} mentions a forbidden name`).toBe(false);
    }
  });

  it('has a copyright and licence header in every source and test file', () => {
    for (const file of ALL_CODE) {
      expect(readFileSync(file, 'utf8'), rel(file)).toMatch(/Copyright 2026 MB AFKzona Group\n\/\/ SPDX-License-Identifier: AGPL-3\.0-only/);
    }
  });

  it('has no any, no ts-ignore and no eslint-disable without a reason', () => {
    for (const file of ALL_CODE.filter((f) => f !== import.meta.filename)) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(/\/[/*]\s*eslint-disable[^\n]*/g)) expect(m[0], rel(file)).toMatch(/ -- \S/);
      expect(/@ts-ignore|@ts-nocheck/.test(text), rel(file)).toBe(false);
      expect(/:\s*any\b|\bas any\b|<any>/.test(text), rel(file)).toBe(false);
    }
  });

  it('keeps the attribution in every interface', () => {
    expect(readFileSync(join(ROOT, 'src/ui/pages.ts'), 'utf8')).toContain('ATTRIBUTION.text');
    expect(readFileSync(join(ROOT, 'src/docs/render.ts'), 'utf8')).toContain('ATTRIBUTION.text');
    expect(readFileSync(join(ROOT, 'src/cli/run.ts'), 'utf8')).toContain('ATTRIBUTION.text');
    expect(readFileSync(join(ROOT, 'LICENSE-ADDITIONAL-TERMS.md'), 'utf8')).toContain('"Offramp by AFKzona Group"');
  });
});

describe('package', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as Record<string, unknown>;

  it('has zero runtime dependencies and no install scripts', () => {
    expect(pkg.dependencies).toBeUndefined();
    expect(pkg.optionalDependencies).toBeUndefined();
    expect(pkg.peerDependencies).toBeUndefined();
    const scripts = pkg.scripts as Record<string, string>;
    for (const hook of ['preinstall', 'install', 'postinstall', 'prepare']) expect(scripts[hook]).toBeUndefined();
  });

  it('pins every development dependency exactly', () => {
    for (const [name, version] of Object.entries(pkg.devDependencies as Record<string, string>)) expect(version, name).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('declares licence, engines, exports, bin and a files allow-list', () => {
    expect(pkg).toMatchObject({ name: '@afkzona/offramp', license: 'AGPL-3.0-only', type: 'module', engines: { node: '>=22' }, bin: { offramp: './dist/cli/main.js' } });
    expect(pkg.version).toBe(VERSION);
    expect(pkg.files).toEqual(expect.arrayContaining(['dist/', 'schema/', 'LICENSE', 'LICENSE-ADDITIONAL-TERMS.md']));
    expect((pkg.repository as { url: string }).url).toBe('git+https://github.com/afkzonagroup/offramp.git');
  });

  it('has the CLI shebang', () => {
    expect(readFileSync(join(ROOT, 'src/cli/main.ts'), 'utf8').startsWith('#!/usr/bin/env node\n')).toBe(true);
  });
});

describe('GitHub Action and workflows', () => {
  const action = readFileSync(join(ROOT, 'action.yml'), 'utf8');

  it('passes inputs only through environment variables', () => {
    const runBlocks = action.split(/\n\s+run: \|\n/).slice(1);
    expect(runBlocks.length).toBe(2);
    for (const b of runBlocks) expect(b.split(/\n {4}- /)[0]).not.toContain('${{');
    expect(action).toContain('OFFRAMP_PROFILE: ${{ inputs.profile }}');
    expect(action).toContain('--github-output -- "$profile"');
    expect(action).toContain('case "$OFFRAMP_PROFILE" in ""|/*|..|../*|*/..|*/../*|');
    expect(action).toContain('case "$OFFRAMP_FAIL_ON" in conflict|missing|review|never) ;; *)');
    expect(action).not.toContain('realpath');
  });

  it('pins every action to a commit SHA', () => {
    const workflows = files(join(ROOT, '.github/workflows'), /\.ya?ml$/).map((f) => readFileSync(f, 'utf8'));
    for (const text of [action, ...workflows]) {
      for (const m of text.matchAll(/uses:\s*([^\s#]+)/g)) {
        const ref = m[1] ?? '';
        if (ref.startsWith('./')) continue;
        expect(ref, ref).toMatch(/@[0-9a-f]{40}$/);
      }
    }
  });

  it('builds before packing and refuses a tarball without the compiled code (ignore-scripts skips prepack)', () => {
    expect(readFileSync(join(ROOT, '.npmrc'), 'utf8')).toContain('ignore-scripts=true');
    expect(lstatSync(join(ROOT, 'scripts/check-pack.mjs')).isFile()).toBe(true);
    for (const f of ['ci.yml', 'release.yml']) {
      const text = readFileSync(join(ROOT, '.github/workflows', f), 'utf8');
      const steps = ['- run: npm run build\n', '- run: npm pack --dry-run --json > "$RUNNER_TEMP/pack.json"\n', '- run: node scripts/check-pack.mjs "$RUNNER_TEMP/pack.json"\n'];
      let from = 0;
      for (const step of steps) {
        const i = text.indexOf(step, from);
        expect(i, `${f}: ${step.trim()}`).toBeGreaterThanOrEqual(from);
        from = i + step.length;
      }
      if (f === 'release.yml') expect(text.indexOf('npm publish'), f).toBeGreaterThan(from);
    }
  });

  it('runs CI only on pull requests and on demand, with read-only permissions', () => {
    for (const f of ['ci.yml', 'codeql.yml']) {
      const text = readFileSync(join(ROOT, '.github/workflows', f), 'utf8');
      expect(text, f).toMatch(/on:\n {2}pull_request:\n {2}workflow_dispatch:\n/);
      expect(text, f).not.toMatch(/\n {2}push:|schedule:/);
      expect(text, f).toMatch(/permissions:\n {2}contents: read/);
    }
  });
});
