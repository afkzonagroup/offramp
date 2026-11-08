// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

// Runs the TypeScript examples in README.md, so the documentation stays true.

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { HELP } from '../src/cli/run.ts';

const ROOT = join(import.meta.dirname, '..');
const TMP = join(import.meta.dirname, '.readme-tmp');
const README = readFileSync(join(ROOT, 'README.md'), 'utf8');

function examples(language: string): [string, string][] {
  const out: [string, string][] = [];
  const re = new RegExp(`<!-- example:([a-z-]+) -->\\n\`\`\`${language}\\n([\\s\\S]*?)\`\`\``, 'g');
  for (const m of README.matchAll(re)) out.push([m[1] ?? '', m[2] ?? '']);
  return out;
}

afterAll(() => {
  rmSync(TMP, { recursive: true, force: true });
});

describe('README', () => {
  const ts = examples('ts');

  it('has the expected examples', () => {
    expect(ts.map(([name]) => name)).toEqual(['library']);
  });

  it.each(ts)('runs the %s example', async (name, code) => {
    mkdirSync(TMP, { recursive: true });
    const file = join(TMP, `${name}.ts`);
    writeFileSync(file, code.replace(/'@afkzona\/offramp'/g, `'${pathToFileURL(join(ROOT, 'src/index.ts')).href}'`));
    // eslint-disable-next-line no-restricted-syntax -- loads the README example written above, not user input
    await expect(import(pathToFileURL(file).href)).resolves.toBeDefined();
  });

  it('documents every command of the CLI help', () => {
    for (const cmd of ['profile check', 'profile example', 'schema', 'request create', 'request event', 'request charge', 'timeline', 'docs', 'ui']) {
      expect(HELP).toContain(`offramp ${cmd}`);
      expect(README).toContain(`offramp ${cmd}`);
    }
  });

  it('has the sections the project family requires', () => {
    for (const h of ['## Why', '## Quick start', '## How it maps to the law', '## Limitations', '## Security', '## Dependencies', '## Licence and Enterprise', '## Contributing', '## Disclaimer']) expect(README).toContain(h);
    // The README may say that Offramp never says "compliant"; it must not claim compliance.
    expect(README).not.toMatch(/\b(is|are|be|makes?|become|becomes|ensures?)\s+(\w+\s+)?compliant\b/i);
    expect(README).not.toMatch(/\bensures? compliance\b/i);
  });
});
