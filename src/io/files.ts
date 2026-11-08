// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

import { randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { chmod, lstat, mkdir, open, rename, unlink } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { OfframpError } from '../util/errors.ts';
import { printable } from '../util/validate.ts';

/** Owner read/write only. */
export const PRIVATE_FILE_MODE = 0o600;
/** Owner only. */
export const PRIVATE_DIR_MODE = 0o700;

/** O_NONBLOCK so that opening a FIFO or device cannot hang before the regular-file check. */
const NONBLOCK = constants.O_NONBLOCK;

function ioError(path: string, err: unknown, verb: string): OfframpError {
  const code = (err as NodeJS.ErrnoException).code;
  const name = printable(basename(path), 80);
  if (code === 'ENOENT') return new OfframpError('NOT_FOUND', `${name} does not exist.`);
  if (code === 'ELOOP' || code === 'EMLINK') return new OfframpError('IO', `${name} is a symbolic link; refusing to follow it.`);
  if (code === 'EEXIST') return new OfframpError('CONFLICT', `${name} already exists. Use --force to replace it.`);
  return new OfframpError('IO', `Could not ${verb} ${name}: ${code ?? 'I/O error'}.`);
}

/** Validates a user-supplied path and resolves it. Rejects NUL bytes, empty and overlong paths. */
export function safePath(p: string, what: string): string {
  if (p.length === 0 || p.length > 4096 || p.includes('\0')) throw new OfframpError('USAGE', `${what}: invalid path.`);
  return resolve(p);
}

/**
 * Reads a regular file as UTF-8 with a size cap. The file is opened once without following a symbolic link
 * at the last path component, and checked and read through that handle, so it cannot be swapped in between.
 * Invalid UTF-8 is rejected rather than replaced.
 */
export async function readTextFile(path: string, maxBytes: number): Promise<string> {
  let fh;
  try {
    fh = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | NONBLOCK);
  } catch (err) {
    throw ioError(path, err, 'read');
  }
  try {
    const st = await fh.stat();
    if (!st.isFile()) throw new OfframpError('IO', `${printable(basename(path), 80)} is not a regular file.`);
    if (st.size > maxBytes) throw new OfframpError('IO', `${printable(basename(path), 80)} is larger than ${maxBytes} bytes.`);
    const buf = await fh.readFile();
    if (buf.length > maxBytes) throw new OfframpError('IO', `${printable(basename(path), 80)} is larger than ${maxBytes} bytes.`);
    try {
      return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(buf);
    } catch {
      throw new OfframpError('INVALID', `${printable(basename(path), 80)} is not valid UTF-8.`);
    }
  } finally {
    await fh.close().catch(() => undefined);
  }
}

async function syncDir(dir: string): Promise<void> {
  const fh = await open(dir, constants.O_RDONLY).catch(() => undefined);
  if (fh === undefined) return;
  // Some platforms cannot fsync a directory; the rename is atomic regardless.
  await fh.sync().catch(() => undefined);
  await fh.close().catch(() => undefined);
}

/**
 * Writes a file with mode 0600. Without `replace`, the file is created exclusively (an existing file or a
 * symbolic link at the path is an error). With `replace`, a temporary file is written next to it and renamed
 * over it, which replaces a symbolic link itself instead of writing through it; readers see the old or the
 * new content, never a partial file.
 */
export async function writeTextFile(path: string, data: string, replace: boolean): Promise<void> {
  if (!replace) {
    let fh;
    try {
      fh = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, PRIVATE_FILE_MODE);
    } catch (err) {
      throw ioError(path, err, 'write');
    }
    try {
      await fh.writeFile(data, 'utf8');
      await fh.sync();
    } catch (err) {
      throw ioError(path, err, 'write');
    } finally {
      await fh.close().catch(() => undefined);
    }
    return;
  }
  const dir = dirname(path);
  const tmp = join(dir, `.${basename(path)}.${randomBytes(8).toString('hex')}.tmp`);
  let renamed = false;
  try {
    const fh = await open(tmp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, PRIVATE_FILE_MODE);
    try {
      await fh.writeFile(data, 'utf8');
      await fh.sync();
    } finally {
      await fh.close();
    }
    await chmod(tmp, PRIVATE_FILE_MODE);
    await rename(tmp, path);
    renamed = true;
    await syncDir(dir);
  } catch (err) {
    if (!renamed) await unlink(tmp).catch(() => undefined);
    if (err instanceof OfframpError) throw err;
    throw ioError(path, err, 'write');
  }
}

/** Creates a private directory (0700) if missing. Refuses a symbolic link or a non-directory at the path. */
export async function ensurePrivateDir(path: string): Promise<void> {
  try {
    await mkdir(path, { recursive: true, mode: PRIVATE_DIR_MODE });
  } catch (err) {
    throw ioError(path, err, 'create');
  }
  const st = await lstat(path);
  if (st.isSymbolicLink() || !st.isDirectory()) throw new OfframpError('IO', `${printable(basename(path), 80)} is not a directory.`);
}
