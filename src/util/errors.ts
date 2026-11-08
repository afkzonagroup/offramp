// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

/** Error codes the library raises. Messages are safe to show to users; they never contain stack traces. */
export type OfframpErrorCode = 'INVALID' | 'NOT_FOUND' | 'CONFLICT' | 'IO' | 'USAGE';

/** The single error type the library throws on bad input or a refused operation. */
export class OfframpError extends Error {
  readonly code: OfframpErrorCode;
  /** JSON path of the offending value, e.g. "$.services[0].id", when known. */
  readonly path: string | undefined;

  constructor(code: OfframpErrorCode, message: string, path?: string) {
    super(message);
    this.name = 'OfframpError';
    this.code = code;
    this.path = path;
  }
}

/** Throws an INVALID error. */
export function invalid(message: string, path?: string): never {
  throw new OfframpError('INVALID', message, path);
}

/** Text that may be shown to a user for any thrown value. Unknown errors never leak their message. */
export function publicMessage(err: unknown): string {
  if (err instanceof OfframpError) return err.path === undefined ? err.message : `${err.path}: ${err.message}`;
  return 'Unexpected internal error.';
}
