# Changelog

All notable changes to this project are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the
project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] - 2026-11-08

### Added

- Provider profile and switching request models with hand-written
  validators, and JSON Schemas (draft 2020-12) for both.
- Timeline engine for Article 25 of Regulation (EU) 2023/2854: notice period
  (at most two months), transitional period (30 calendar days), technical
  unfeasibility notice (14 working days) and alternative period (at most
  seven months), customer extension, retrieval period (at least 30 calendar
  days), termination and erasure. Time-zone and DST safe, public holidays
  configurable.
- Lifecycle rules for recording events on a switching request.
- Switching charge checks under Article 29 (reduced charges until
  11 January 2027, none from 12 January 2027) and Article 34(2).
- Contract-terms checker for Articles 23, 25, 26, 28, 29, 30 and 31.
- Documents in Markdown, self-contained HTML and JSON: information pack,
  switching plan, receipt notice, technical unfeasibility notice, extension
  confirmation, completion notice, erasure confirmation.
- `offramp` command line tool and a local web interface.
- Request export and import format with a SHA-256 integrity check.
- GitHub Action that checks a provider profile.
