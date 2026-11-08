# Review record

Two review passes were made after the build, as the project standards
require. Each lists what was checked, what was found and what was fixed.

## Pass 1: correctness against the law, edge cases, API, tests

### Checked

- Every period and date against the official English text on EUR-Lex
  (Regulation (EU) 2023/2854, OJ L, 2023/2854, 22.12.2023): Art. 2 points (8),
  (9), (30), (32) to (38); Art. 23 to 31; Art. 34; Art. 50. Every quotation in
  LEGAL.md was compared with the downloaded official text by script; elided
  quotations part by part.
- The counting rules on boundary days: month ends (31 December + 2 months,
  31 July + 7 months, leap years), the request day in the profile's time zone
  against UTC, both DST changes in Vilnius, a zone whose clocks skip midnight
  (Santiago), every day of 2026 in eight zones, the 14th working day with
  weekends and holidays, the last millisecond of a period, 12 January 2027
  and 12 September 2025.
- The state machine of a request: each event type at each state, order,
  future events, closed requests, erase-only requests.
- The charge rules: phases on both sides of each date, cost comparisons,
  zero amounts, custom-built and non-production services, in-parallel
  egress, additional services, penalties and fees.
- The contract checker: every Art. 25 clause reported on a bare profile,
  every numeric limit on both sides, Art. 30(1) only for IaaS, Art. 30(2)
  only for other services, Art. 31 regimes, no finding or summary saying
  "compliant".
- Documents: every kind in every format; "Not stated" for gaps instead of
  invented content; warnings carried into notices.
- The JSON Schemas against the validators on the same valid and invalid
  examples (Ajv, draft 2020-12, strict mode).
- The README example runs in the test suite; the quick start was run from a
  packed tarball in an empty folder.
- The UI in a real browser (Chromium) at 1280 px and 390 px: every page and
  each HTML document, screenshots inspected, no console errors, no
  horizontal scroll.

### Found and fixed

| # | Finding | Fix |
|---|---|---|
| 1 | In a real browser every form post was refused: under `Referrer-Policy: no-referrer` Chromium sends `Origin: null` on POST, and the Origin check rejects it. Header-level tests could not see this. | Policy changed to `same-origin` (the real Origin reaches the UI, no referrer reaches other sites); test asserts the policy with the reason. |
| 2 | A POST refused before its body was read (413, 415, 403) kept the connection waiting for the unread body. | Such responses send `Connection: close`; test covers it. |
| 3 | `offramp request charge` reported findings of earlier charges and failed on them. | Reports the charge just recorded; `offramp timeline` reports all. |
| 4 | Several forms on the request page shared field ids, so labels pointed at the first form. | Field ids are scoped per form. |
| 5 | Timeline tables were unreadable on phones (one word per line), dates and citations broke mid-token, key-value lists squeezed values. | Rows stack with labels under 640 px (static CSS, inside each CSP), short cells do not wrap, lists stack. |
| 6 | Request dates near year 9999 could overflow the date format during month arithmetic and make the timeline throw. | Request instants and dates must be before 3000-01-01; tests. |
| 7 | An erase-only request could be withdrawn after its contract had already ended at the end of the notice period. | Refused; test. |
| 8 | The schema's URL pattern rejected `https://host?query`, which the validator accepts. | Pattern widened; agreement test case added. |
| 9 | LEGAL.md quoted "without prejudice to paragraph 4" in lower case. | Quoted exactly. |

## Pass 2: security, with an attacker's and a hostile contributor's eyes

### Checked

Line by line against the security checklist of the project standards, and
by trying to break each control:

- **Mutation check of every security control.** Each control was removed in
  turn and the test suite run; every removal makes a test fail (see the
  table below).
- Inputs: size limits before parsing; nesting limit (V8 parses 500,000
  levels iteratively, the depth check stops at 33); prototype keys anywhere
  in the document; unknown keys; control, bidirectional and zero-width
  characters; URL schemes and credentials; regular expressions checked for
  catastrophic backtracking at their maximum input length.
- Documents: script, event-handler, iframe, SVG, link and Markdown block
  injection through every user-controlled field; `javascript:` and `data:`
  links; CSP with the stylesheet hash; no inline styles or scripts.
- Local UI: login token, session cookie, CSRF, Origin, Fetch Metadata, Host
  (DNS rebinding), clickjacking, methods, content type, body and field
  limits, invalid UTF-8, rate limiting per instance, idle expiry, error
  pages without stack traces, path traversal through request ids (encoded
  slashes, dot segments, NUL), symbolic links in the data folder, stale
  forms.
- Files: reads through one `O_NOFOLLOW` handle with a size cap, exclusive
  creation, atomic replacement that replaces a link instead of writing
  through it, modes 0600 and 0700.
- CLI: terminal escape sequences in messages and paths; `$GITHUB_OUTPUT`
  receives only integers from the current run; flags of other commands are
  errors, not ignored.
- GitHub Action and workflows: inputs only through environment variables;
  the profile path must be relative, without `..` segments; actions pinned to
  SHAs; `pull_request` (never `pull_request_target`) and
  `workflow_dispatch` only; read-only permissions; release through OIDC
  with a protected environment.
- Supply chain: zero runtime dependencies, exact devDependency versions,
  lockfile, `ignore-scripts=true`, `npm audit --omit=dev` clean,
  `npm audit` clean (with a `minimatch` override as in the other projects),
  `files` allow-list checked with `npm pack --dry-run`.
- Hygiene: no tool or vendor names in any file, no raw invisible or
  bidirectional characters in any text file (scanned by a test), licence
  headers, no `any`, no unexplained lint suppressions.

### Mutation results

| Control removed | Result |
|---|---|
| CSRF token comparison | ui.test.ts fails |
| Origin check | ui.test.ts fails |
| Sec-Fetch-Site check | ui.test.ts fails |
| Form content-type check | ui.test.ts fails |
| Host allow-list (DNS rebinding) | ui.test.ts fails |
| Rate limiter | ui.test.ts fails |
| Body limit on Content-Length | ui.test.ts fails |
| Body limit while reading | ui.test.ts fails |
| Form field limit | ui.test.ts fails |
| One-time login token | ui.test.ts fails |
| Idle session expiry | ui.test.ts fails |
| HttpOnly and SameSite cookie flags | ui.test.ts fails |
| Content-Security-Policy header | ui.test.ts fails (after fix 1 below) |
| X-Frame-Options header | ui.test.ts fails (after fix 1 below) |
| Referrer-Policy same-origin | ui.test.ts fails |
| Sandbox and frame-ancestors on served documents | ui.test.ts fails |
| Loopback-only binding | ui.test.ts fails |
| Revision check (stale forms) | ui.test.ts fails |
| Request id check in the store | ui.test.ts fails |
| Symbolic-link check on the data folder | ui.test.ts fails |
| Connection close after early refusal | ui.test.ts fails |
| O_NOFOLLOW on reads | cli.test.ts fails |
| O_EXCL on new files | cli.test.ts fails |
| File mode 0600 | cli.test.ts fails |
| Size cap before reading a file | still passes alone: the cap after reading catches the same file (layered); removing both fails cli.test.ts (after fix 4) |
| Strict UTF-8 decoding | cli.test.ts fails |
| Integer-only $GITHUB_OUTPUT | cli.test.ts fails (after fix 2) |
| Printable CLI messages | cli.test.ts fails (after fix 3) |
| HTML escaping in the html tag | docs.test.ts fails |
| Markdown inline escaping | docs.test.ts fails |
| Markdown block escaping | docs.test.ts fails |
| http(s)-only links | docs.test.ts fails |
| CSP meta in documents | docs.test.ts fails |
| Prototype keys in JSON | validate.test.ts fails |
| JSON nesting limit | validate.test.ts fails |
| JSON size limit | validate.test.ts fails |
| Control and bidirectional characters | validate.test.ts fails |
| Unknown properties | validate.test.ts fails |
| URL scheme allow-list | validate.test.ts fails (after fix 5) |
| Request date bound | validate.test.ts fails |
| Export digest | connectors.test.ts fails |
| Hidden internal error messages | validate.test.ts fails |
| Late withdrawal of erase-only requests | lifecycle.test.ts fails |

### Found and fixed

| # | Finding | Fix |
|---|---|---|
| 1 | The tests of the CSP and X-Frame-Options headers compared the response with the same constant the server uses, so deleting a header from the constant passed. | Literal header values asserted. |
| 2 | The integer guard on `$GITHUB_OUTPUT` was never reached by a test (validation stops bad names earlier). | Guard moved into `githubOutputLines`, tested with NaN and negative counts. |
| 3 | The terminal escaping of CLI messages was only tested on a message already escaped at its source. | Test with an option name containing ESC and BEL from Node's argument parser. |
| 4 | The file size cap was only tested through the JSON parser's own limit. | Direct tests of the file reader's cap and of atomic replacement. |
| 5 | The URL scheme check was only tested with `javascript:`, which the host check also rejects. | `ftp:` and `file:` cases. |
| 6 | The GitHub Action used GNU `realpath -m`, which fails on macOS runners. | Portable check: a relative path without `..` segments; tested in a shell and asserted in `repo.test.ts`. |
| 7 | `offramp ui` printed the data folder path without terminal escaping. | Printed through `printable`. |

### Accepted residual risks

- The revision check in the UI leaves a short window between reading and
  replacing a file when the CLI and the UI change the same request at the
  same moment. Single-user local tool; documented in SECURITY.md.
- Anyone who can write the data folder can make the UI read up to 2,000
  files of 1 MiB on each list view. That person already controls the data.
- Markdown viewers may auto-link plain URLs that appear in text; all other
  Markdown and HTML syntax is escaped.
- The request export digest detects changes but is not a signature.

## Independent review (8 Nov 2026)

A separate review that did not rely on this file, LEGAL.md or the README.

### What was checked

- **Law.** Art. 2 points (8), (9) and (30) to (38), Art. 23 to 31, 34 and 50
  and recitals 79 to 90, 95, 98 and 99, read in the official English text of
  Regulation (EU) 2023/2854 on EUR-Lex. Every period, start point, cap, charge
  rule and date in `src/legal/refs.ts`, the timeline, the charge rules, the
  contract checker, the documents, README and LEGAL.md was compared with it.
  Entry into force (11 January 2024, the twentieth day after publication on
  22 December 2023), application (12 September 2025) and 12 January 2027 are
  right. The arithmetic behind interpretation choice 7 (two months span 59 to
  62 days) was checked.
- **Dates.** An independent calculator built on the Temporal API (its own
  calendar and time-zone code, not the engine's Intl search) was compared with
  `computeTimeline` over 12,000 generated requests in 16 time zones, including
  zones with daylight-saving changes at midnight (America/Santiago,
  Asia/Beirut, America/Havana), half-hour changes (Australia/Lord_Howe),
  UTC+14 and UTC-11, month ends, 29 February, holiday lists, agreed start
  dates, unfeasibility notices on time and late, extensions, completion,
  erasure, withdrawal and erase-only requests: received day, notice end and
  its instant, transitional period, seven-month cap, 14-working-day deadline,
  retrieval end, erasure day and instant, state. No differences. Wall-clock
  parsing and start of day were compared at 5,440 points around every offset
  change from 2024 to 2027 in 11 zones: no differences.
- **Contract checker** on realistic good and bad profiles (three-month notice,
  45-day transition, 14-day retrieval, 20 working days to notify, paid
  interfaces, exemptions without trade-secret risk, egress charges past the
  cut-over, mixed and special regimes).
- **Security.** Every control listed below was removed one at a time and the
  suite run (70 mutations; all but the two in I-15 now fail a test). Hostile JSON (size, depth, prototype keys,
  inherited properties), file reads and writes (symbolic links, FIFOs, huge
  sparse files, overwrite), the exchange envelope, the Action inputs and
  `$GITHUB_OUTPUT`, regular expressions for backtracking.
- **Browser.** The UI was run from the CLI in Playwright's bundled Chromium at
  1280 px and 390 px and every form was submitted for real: new request (valid
  and invalid), transitional period started, unfeasibility, extension (valid
  and refused), completion, erasure, withdrawal, charge, lock. All 13 form
  posts per width carried the page's own `Origin` (Referrer-Policy
  `same-origin`); every document link opened; no page scrolls sideways.
- **Packaging.** From a fresh `git clone`: `npm ci --ignore-scripts`, the
  release.yml steps in order, `npm pack --dry-run --json`, the pack check, then
  the README quick start, the `ui` command and the README library example run
  from the packed tarball in an empty folder.
- **Hygiene.** Tracked files for the forbidden vendor words, for raw
  bidirectional, zero-width, separator and BOM characters, commit authors and
  messages, licence files and the 7(b) attribution.

### Findings

| # | Severity | Finding | Status |
|---|---|---|---|
| I-1 | Medium | `release.yml` ran `node scripts/check-pack.mjs`, which was not in the repository, so a release would stop at that step; `ci.yml` packed without building (with `ignore-scripts=true`, `prepack` never runs, so a pack without a build has no `dist/`). | Fixed: script added, CI builds, packs to `$RUNNER_TEMP/pack.json` and checks it; a test keeps both workflows in that order. |
| I-2 | Medium | `validateRequest` did not apply the event-log rules that `addEvent` enforces. An imported or hand-edited file could hold two customer extensions (Art. 25(5): once; the timeline silently used the first), a completion dated before the request, events out of order or after erasure, or switching events on an erase-only request, without any warning. | Fixed: refused at validation, with tests on import. |
| I-3 | Medium | The example Lithuanian holiday list left out 2 November (a public holiday since 2020) and Easter Monday 2027, so the README quick start gave the 14-working-day deadline as 19 instead of 20 November 2026. | Fixed. |
| I-4 | Medium | A service stated as custom-built but also as offered at broad commercial scale was reported as a conflict, yet its Art. 29 charge checks and Art. 30(1) functional equivalence checks were still skipped (false negatives). | Fixed: such a service gets the full rules. |
| I-5 | Low | Standard service fees were flagged only after the transitional period, although the contract ends on successful completion (Art. 25(2)(c)(i)) and, for erasure, at the end of the notice period (Art. 25(2)(c)(ii)). | Fixed: `contractLastDay(timeline)`; LEGAL.md choice 17 updated. |
| I-6 | Low | About 500,000 nested brackets fit in the 1 MiB limit and overflowed the stack in `JSON.parse`'s reviver: a RangeError instead of `OfframpError`, "Unexpected internal error" in the CLI. | Fixed: depth checked on the text first, in one linear pass. |
| I-7 | Low | `escapeMarkdown` used `/\s*\n\s*/g`, which backtracks quadratically over long runs of spaces. | Fixed: linear split; equivalence checked on 200,000 random strings. |
| I-8 | Low | A profile whose services are all non-production versions still got every Art. 25, 26, 28 and 29 item reported as missing, although Art. 31(2) disapplies Chapter VI. | Fixed: only Art. 31 is checked then. |
| I-9 | Low | Five security controls could be removed without any test failing: UTF-8 body check (the test sent valid UTF-8 and accepted 403), https origin only for extra hosts, size check before reading a file, own-property check on validated objects, `fail-on` allow-list in the Action. | Fixed: each now fails a test when removed. |
| I-10 | Low | At 390 px, a finding with a subject put its text in the narrow label column, and document row labels ran into short values. | Fixed. |
| I-11 | Low | LEGAL.md did not say that, unlike Art. 3(4) of Regulation 1182/71, periods ending on a weekend or holiday are not extended, which gives the earliest erasure date. | Fixed (documented). |
| I-12 | Medium | Choice 9: a late unfeasibility notice still moves the end of the transitional period in the timeline, so a provider that notified late and completed within the alternative period sees "done". The conflict finding is shown, but neither party gets the conservative date. Suggested change: keep the standard end as the deadline after a late notice and anchor the retrieval period on the later end. | Fixed (owner's decision): the standard end stays the deadline; the retrieval period starts after the later end (`disregardedLastDay`); LEGAL.md choice 9. |
| I-13 | Low | Same pattern for an imported customer extension recorded after the transitional period ended: flagged as a conflict but still applied. | Fixed: flagged and not applied to the deadline (refusing it at validation would need the profile, and would hide what was recorded); retrieval after the named end; LEGAL.md choice 10. Recording it was already refused. |
| I-14 | Low | At 390 px two long placeholders on the new-request form are cut off ("Agreed first day of the transitional period (optiona…", "Destination provider (for a switch to another prov…"); labels are screen-reader only by design. | Fixed: those two, the retrieval-days placeholder and the alternative-period placeholder on the request page shortened; every input placeholder measured in Chromium at 390 px fits (the long textarea placeholder wraps). |
| I-17 | Medium | README and COMMERCIAL.md listed a hosted dashboard, monitoring, SSO, roles, audit evidence packs, a legal-update feed and SLA support, which do not exist. | Fixed: wording limited to the commercial licence, integration, custom connectors and features, and support agreements. |
| I-15 | Info | Two controls cannot be shown by a behavioural test: the constant-time token comparison (timing) and the session-cookie format pre-check (the session map refuses unknown values anyway). | Accepted. |
| I-16 | Info | An existing data folder keeps its permissions; only a folder Offramp creates gets 0700. Request files are 0600 either way. | Accepted. |

### Interpretation choices

1 (counting, not 1182/71): defensible; stricter for the provider's deadlines,
earliest for erasure, now stated. 2 (months): same result as Art. 3(2)(c) of
Regulation 1182/71. 3 (calendar days): what the text says. 4 (working days,
listed holidays only): defensible; without a list it gives the earliest
deadline for the provider who must notify. 5 (profile time zone): defensible
and stated in every timeline. 6 (start after the notice period): the text's
own words; a later agreed start is flagged. 7 (notice in days): arithmetic
correct. 8 (seven months from the same point as the 30 days): the plain
reading of "alternative transitional period". 9 (late notice): changed per I-12, now
conservative for the customer. 10 (one extension, no maximum): matches Art. 25(5) and recital 87;
"once" now also holds for imported files, and a late extension no longer
moves the deadline (I-13). 11 (retrieval after the agreed end
even after early completion): matches "the transitional period that was
agreed" and never erases earlier. 12 (erase-only): the text sets no retrieval
period; stated as an assumption. 13 (12 January 2027 counted as prohibited):
the conservative resolution. 14 (nothing regulated before 12 September 2025):
follows Art. 50. 15, 16: no overclaim; a person decides. 17: corrected (I-5).
18: corrected for services offered at scale (I-4).

### Result

347 tests pass; `npm run check` passes.

## Coordinator review (8 Nov 2026)

Accepted. Decided the reviewer's open legal question (I-12): after a late unfeasibility notice the standard transitional end stays the provider's deadline, and retrieval runs from the later end. That is implemented, with I-13, I-14 and the corrected commercial wording. Checked:
- the UI keeps `Referrer-Policy: same-origin`, and real form posts work in Chromium;
- release and CI build and check the packed tarball;
- the only author is antonmacius-droid;
- `npm run check` passes with 347 tests.
