// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Offramp: switching between data processing services under Chapter VI of Regulation (EU) 2023/2854 (Data Act).
 *
 * Library entry point. Everything here is pure and offline except the local UI (`startUi`), which listens on a
 * loopback address and stores requests in a folder you choose.
 */

export { EUR_LEX_URL, ELI_URL, LAW, REF, art, recital, type ArticleRef } from './legal/refs.ts';
export * from './model/profile.ts';
export * from './model/request.ts';
export { validateProfile, parseProfile, PROFILE_LIMITS } from './model/parse-profile.ts';
export { validateRequest, validateEvent, parseRequest, checkRequestAgainstProfile, REQUEST_LIMITS } from './model/parse-request.ts';
export { computeTimeline, contractLastDay, STATES, MILESTONE_IDS, type Timeline, type Milestone, type MilestoneId, type MilestoneStatus, type RequestState, type Period, type TimelineOptions } from './engine/timeline.ts';
export { addEvent, createRequest, type NewRequest } from './engine/lifecycle.ts';
export { lastDayOfDays, lastDayOfMonths, lastDayOfWorkingDays, isWorkingDay } from './engine/periods.ts';
export { checkChargeSchedule, checkAppliedCharges, chargePhase, isSwitchingCharge, LAST_REDUCED_CHARGE_DAY, type ChargePhase } from './rules/charges.ts';
export { checkProfile, TWO_MONTHS_IN_DAYS, type ProfileReport } from './rules/contract.ts';
export { SEVERITIES, summarise, countBySeverity, sortFindings, type Finding, type Severity } from './rules/findings.ts';
export { informationPack, switchingPlan, receiptNotice, unfeasibilityNotice, extensionConfirmation, completionNotice, erasureConfirmation, generateDocument, type DocOptions } from './docs/generate.ts';
export { renderMarkdown, renderHtml, renderJson, renderDocument, escapeMarkdown, DOC_CSP, DOC_MEDIA_TYPES } from './docs/render.ts';
export { DOC_KINDS, DOC_FORMATS, ATTRIBUTION, DISCLAIMER, type DocKind, type DocFormat, type OfframpDocument, type DocSection, type Block } from './docs/model.ts';
export { PROVIDER_PROFILE_SCHEMA, SWITCHING_REQUEST_SCHEMA, PROFILE_SCHEMA_ID, REQUEST_SCHEMA_ID, schemaText } from './connectors/schema.ts';
export { exportRequest, importRequest, EXCHANGE_FORMAT, type RequestExport, type ImportResult } from './connectors/exchange.ts';
export { startUi, fixedWindowLimiter, UI_CSP, type UiOptions, type UiHandle, type RateLimiter } from './ui/server.ts';
export { parseInstant, formatLocal, isValidTimeZone, addDays, addMonthsClamped, startOfDay, endOfDay, dateIn, type LocalDate } from './time/zone.ts';
export { OfframpError, type OfframpErrorCode } from './util/errors.ts';
export { digest } from './util/json.ts';
export { EXAMPLE_PROFILE } from './example.ts';
export { EXAMPLE_REQUEST } from './example-request.ts';
export { VERSION } from './version.ts';
