#!/usr/bin/env node
// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

import { startUi } from '../ui/server.ts';
import { printable } from '../util/validate.ts';
import { run } from './run.ts';

const code = await run(process.argv.slice(2), {
  out: (t) => process.stdout.write(t),
  err: (t) => process.stderr.write(t),
  env: (name) => process.env[name],
  now: () => Date.now(),
  serve: async (o) => {
    const ui = await startUi({ profile: o.profile, dataDir: o.dataDir, host: o.host, port: o.port, allowNonLoopback: o.allowNonLoopback, allowedHosts: o.allowedHosts });
    process.stdout.write(`Offramp is running for ${printable(o.profile.provider.name)}. Requests are stored in ${printable(o.dataDir, 1000)}\nOpen this one-time link (it works once):\n  ${ui.loginUrl}\nPress Ctrl+C to stop.\n`);
    const stop = (): void => {
      void ui.close();
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    await ui.closed;
  },
});
process.exitCode = code;
