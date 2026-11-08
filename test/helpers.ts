// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

import { EXAMPLE_PROFILE } from '../src/example.ts';
import { validateProfile } from '../src/model/parse-profile.ts';
import type { ProviderProfile } from '../src/model/profile.ts';
import { validateRequest } from '../src/model/parse-request.ts';
import type { SwitchingRequest } from '../src/model/request.ts';

/** Deep, mutable copy of plain JSON data. */
export function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/**
 * Sets values by dotted path ("contract.noticePeriod", "services.0.regime") on a JSON copy; `undefined` deletes.
 */
export function patch(target: unknown, changes: Readonly<Record<string, unknown>>): void {
  for (const [path, value] of Object.entries(changes)) {
    const keys = path.split('.');
    let node = target as Record<string, unknown>;
    for (const k of keys.slice(0, -1)) {
      if (node[k] === undefined) node[k] = {};
      node = node[k] as Record<string, unknown>;
    }
    const last = keys.at(-1) ?? '';
    if (value === undefined) Reflect.deleteProperty(node, last);
    else node[last] = value;
  }
}

/** The example profile with changes applied (see {@link patch}), validated. */
export function profile(changes: Readonly<Record<string, unknown>> = {}): ProviderProfile {
  const p: unknown = clone(EXAMPLE_PROFILE);
  patch(p, changes);
  return validateProfile(p);
}

/** The example profile as plain JSON with changes applied, not validated. */
export function rawProfile(changes: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
  const p = clone(EXAMPLE_PROFILE) as unknown as Record<string, unknown>;
  patch(p, changes);
  return p;
}

/** A switching request for the example profile, optionally with overrides, validated. */
export function request(overrides: Record<string, unknown> = {}): SwitchingRequest {
  return validateRequest({
    format: 'offramp/switching-request',
    version: 1,
    id: 'SR-T1',
    provider: 'Example Cloud',
    customer: { name: 'Customer' },
    serviceIds: ['crm'],
    target: { kind: 'provider', providerName: 'Destination Cloud' },
    data: { categoryIds: ['crm-records'], assetIds: [] },
    receivedAt: '2026-10-30T08:00:00.000Z',
    events: [],
    charges: [],
    ...overrides,
  });
}

/** UTC milliseconds of an ISO string. */
export function ms(iso: string): number {
  const v = Date.parse(iso);
  if (Number.isNaN(v)) throw new Error(`bad date ${iso}`);
  return v;
}
