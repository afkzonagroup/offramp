// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { ensurePrivateDir, readTextFile, writeTextFile } from '../io/files.ts';
import { parseRequest } from '../model/parse-request.ts';
import type { SwitchingRequest } from '../model/request.ts';
import { OfframpError } from '../util/errors.ts';
import { digest, MAX_JSON_BYTES } from '../util/json.ts';
import { ID_RE } from '../util/validate.ts';

/** At most this many request files are listed, so a crowded folder cannot exhaust memory. */
export const MAX_REQUEST_FILES = 2000;

export interface StoredRequest {
  readonly request: SwitchingRequest;
  /** Digest of the stored request; forms send it back so a concurrent change is detected. */
  readonly rev: string;
}

export interface StoreListing {
  readonly requests: readonly StoredRequest[];
  /** Files that could not be read, by file name, with the reason. */
  readonly errors: readonly { readonly file: string; readonly message: string }[];
}

/**
 * Switching requests kept as one JSON file per request (`<id>.json`) in a private folder. File names come only
 * from validated identifiers, so a request id cannot reach outside the folder. Writes are atomic and serialised
 * within the process; a revision check refuses a write when the file changed since it was shown.
 */
export class RequestStore {
  readonly dir: string;
  #queue: Promise<unknown> = Promise.resolve();

  constructor(dir: string) {
    this.dir = dir;
  }

  async init(): Promise<void> {
    await ensurePrivateDir(this.dir);
  }

  #path(id: string): string {
    if (!ID_RE.test(id) || id.startsWith('.')) throw new OfframpError('INVALID', 'Invalid request id.');
    return join(this.dir, `${id}.json`);
  }

  /** Runs `fn` after every earlier write of this store has finished. */
  #serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.#queue.then(fn, fn);
    this.#queue = next.catch(() => undefined);
    return next;
  }

  async get(id: string): Promise<StoredRequest> {
    const request = parseRequest(await readTextFile(this.#path(id), MAX_JSON_BYTES));
    if (request.id !== id) throw new OfframpError('INVALID', `The file for ${id} contains request ${request.id}.`);
    return { request, rev: digest(request) };
  }

  async list(): Promise<StoreListing> {
    const names = (await readdir(this.dir)).filter((n) => n.endsWith('.json') && ID_RE.test(n.slice(0, -5))).sort();
    const requests: StoredRequest[] = [];
    const errors: { file: string; message: string }[] = [];
    for (const name of names.slice(0, MAX_REQUEST_FILES)) {
      try {
        requests.push(await this.get(name.slice(0, -5)));
      } catch (err) {
        errors.push({ file: name, message: err instanceof OfframpError ? err.message : 'Could not read the file.' });
      }
    }
    if (names.length > MAX_REQUEST_FILES) errors.push({ file: '…', message: `Only the first ${MAX_REQUEST_FILES} files are listed.` });
    return { requests, errors };
  }

  /** Saves a new request; fails if one with the same id exists. */
  create(req: SwitchingRequest): Promise<void> {
    return this.#serial(() => writeTextFile(this.#path(req.id), `${JSON.stringify(req, null, 2)}\n`, false));
  }

  /** Replaces a request if the stored one still has revision `rev`. */
  replace(req: SwitchingRequest, rev: string): Promise<void> {
    return this.#serial(async () => {
      const current = await this.get(req.id);
      if (current.rev !== rev) throw new OfframpError('CONFLICT', 'The request was changed elsewhere since this page was loaded. Reload the page and try again.');
      await writeTextFile(this.#path(req.id), `${JSON.stringify(req, null, 2)}\n`, true);
    });
  }
}
