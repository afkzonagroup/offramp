// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

/** An example switching request against EXAMPLE_PROFILE (fictional customer and destination). */
export const EXAMPLE_REQUEST = {
  $schema: 'https://github.com/afkzonagroup/offramp/raw/main/schema/switching-request.schema.json',
  format: 'offramp/switching-request',
  version: 1,
  id: 'SR-2026-0001',
  provider: 'Example Cloud',
  customer: { name: 'Example Customer UAB', reference: 'C-10422', contactEmail: 'it@customer.example.com' },
  serviceIds: ['crm'],
  target: { kind: 'provider', providerName: 'Destination Cloud', details: 'Destination account DC-778; import through its CSV importer.' },
  data: { categoryIds: ['crm-records', 'crm-files', 'crm-reports', 'crm-audit'], assetIds: ['crm-workflows', 'crm-roles'] },
  receivedAt: '2026-10-30T08:00:00.000Z',
  events: [],
  charges: [],
} as const;
