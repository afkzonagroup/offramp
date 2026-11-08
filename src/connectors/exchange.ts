// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

import { ATTRIBUTION } from '../docs/model.ts';
import type { ProviderProfile } from '../model/profile.ts';
import { checkRequestAgainstProfile, validateRequest } from '../model/parse-request.ts';
import type { SwitchingRequest } from '../model/request.ts';
import { isIsoInstant, toIso } from '../time/zone.ts';
import { invalid } from '../util/errors.ts';
import { digest, parseJson } from '../util/json.ts';
import { obj } from '../util/validate.ts';
import { REQUEST_SCHEMA_ID } from './schema.ts';

/**
 * Export/import format for switching requests, to hand a request between a provider's and a customer's tools
 * or between systems. The envelope carries a SHA-256 of the canonical request JSON. The digest detects
 * accidental changes and truncation; it is not a signature and does not prove who wrote the file.
 */
export const EXCHANGE_FORMAT = 'offramp/switching-request-export';

export interface RequestExport {
  readonly format: typeof EXCHANGE_FORMAT;
  readonly version: 1;
  readonly exportedAt: string;
  readonly generator: string;
  /** Lower-case hex SHA-256 of the canonical JSON of `request` (keys sorted, no whitespace). */
  readonly sha256: string;
  readonly requestSchema: string;
  readonly request: SwitchingRequest;
}

/** Wraps a request in the exchange envelope and returns the JSON text. */
export function exportRequest(req: SwitchingRequest, now: number = Date.now()): string {
  const request = validateRequest(req);
  const env: RequestExport = { format: EXCHANGE_FORMAT, version: 1, exportedAt: toIso(now), generator: `${ATTRIBUTION.text} (${ATTRIBUTION.url})`, sha256: digest(request), requestSchema: REQUEST_SCHEMA_ID, request };
  return `${JSON.stringify(env, null, 2)}\n`;
}

export interface ImportResult {
  readonly request: SwitchingRequest;
  /** Things to know that do not stop the import, e.g. the profile changed since the request was made. */
  readonly warnings: readonly string[];
}

/**
 * Reads an exchange file: checks the envelope, validates the request, verifies the digest, and, when a profile
 * is given, checks the request's references against it. Throws OfframpError (INVALID) on any problem.
 */
export function importRequest(text: string, profile?: ProviderProfile): ImportResult {
  const o = obj(parseJson(text, 'Request export'), '$', ['format', 'version', 'exportedAt', 'generator', 'sha256', 'requestSchema', 'request']);
  if (o.format !== EXCHANGE_FORMAT) invalid(`must be "${EXCHANGE_FORMAT}".`, '$.format');
  if (o.version !== 1) invalid('must be 1.', '$.version');
  if (typeof o.exportedAt !== 'string' || !isIsoInstant(o.exportedAt)) invalid('must be a UTC timestamp.', '$.exportedAt');
  if (typeof o.sha256 !== 'string' || !/^[0-9a-f]{64}$/u.test(o.sha256)) invalid('must be a lower-case hex SHA-256 digest.', '$.sha256');
  const request = validateRequest(o.request);
  if (digest(request) !== o.sha256) invalid('does not match the request: the file was changed or is incomplete.', '$.sha256');
  const warnings: string[] = [];
  if (profile !== undefined) {
    checkRequestAgainstProfile(request, profile);
    if (request.profileDigest !== undefined && request.profileDigest !== digest(profile)) {
      warnings.push('The provider profile has changed since the request was created. Check that the periods and data categories still match what was agreed.');
    }
  }
  return { request, warnings };
}
