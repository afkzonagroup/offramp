// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

// Writes schema/*.schema.json and examples/*.json from the TypeScript sources.
// A test fails when the committed files differ from what this script writes.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { schemaText } from '../src/connectors/schema.ts';
import { EXAMPLE_PROFILE } from '../src/example.ts';
import { EXAMPLE_REQUEST } from '../src/example-request.ts';

const root = join(import.meta.dirname, '..');
writeFileSync(join(root, 'schema/provider-profile.schema.json'), schemaText('profile'));
writeFileSync(join(root, 'schema/switching-request.schema.json'), schemaText('request'));
writeFileSync(join(root, 'examples/provider-profile.json'), `${JSON.stringify(EXAMPLE_PROFILE, null, 2)}\n`);
writeFileSync(join(root, 'examples/switching-request.json'), `${JSON.stringify(EXAMPLE_REQUEST, null, 2)}\n`);
