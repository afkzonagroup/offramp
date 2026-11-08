# Offramp

Offramp works out the switching dates of the Data Act for cloud, SaaS, PaaS
and IaaS providers and their customers, checks a provider's switching terms
and charges, and writes the documents customers receive.

## Why

Chapter VI of the Data Act, [Regulation (EU) 2023/2854](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32023R2854),
gives customers of data processing services the right to switch to another
provider or to their own infrastructure. It applies from **12 September 2025**.
Providers must, among other things:

- start switching after a notice period of **at most two months** and finish
  it within a transitional period of **30 calendar days** (Art. 25(2)(a), (d));
- tell the customer **within 14 working days** if that is technically
  unfeasible, and propose an alternative period of **at most seven months**
  (Art. 25(4));
- let the customer extend the transitional period once (Art. 25(5));
- keep the data retrievable for **at least 30 calendar days** afterwards, then
  erase it (Art. 25(2)(g), (h));
- charge at most the directly linked costs for switching until
  11 January 2027, and **nothing from 12 January 2027** (Art. 29);
- describe the exportable data, formats, interfaces and charges (Art. 25, 26,
  28, 29, 30).

Offramp turns these rules into code you can run on a contract, a request and
a calendar.

## What it does

- **Timeline:** every statutory date of a switching request, in the provider's
  time zone, across month ends and daylight-saving changes, with public
  holidays for the working-day deadline.
- **Lifecycle:** records what happened (unfeasibility notice, customer
  extension, completion, erasure, withdrawal) and refuses events the rules do
  not allow.
- **Charges:** flags switching and egress charges imposed from 12 January
  2027, and reduced charges above the costs the provider states. It never
  decides what a directly linked cost is.
- **Contract checker:** reviews a provider profile against Articles 23 and 25
  to 31 and lists what is missing, contradictory or to review. It never says
  "compliant".
- **Documents:** information pack, switching plan, receipt of the request,
  technical unfeasibility notice, extension confirmation, completion notice
  and erasure confirmation, as Markdown, self-contained HTML and JSON.
- **Connectors:** JSON Schemas for the provider profile and the switching
  request, a request export and import format, a GitHub Action, a command
  line tool and a local web interface.

Everything runs offline. Nothing is sent anywhere.

## Quick start

Requires Node.js 22 or later.

```sh
npm install -g @afkzona/offramp
mkdir switching && cd switching
offramp profile example --out profile.json      # a complete example to edit
offramp profile check profile.json              # what is missing or contradictory
offramp request create --profile profile.json --id SR-1 --customer "Example Customer UAB" \
  --service crm --target provider --destination "Destination Cloud" \
  --received-at 2026-10-30T10:00 --out SR-1.json
offramp timeline SR-1.json --profile profile.json
offramp docs receipt-notice --profile profile.json --request SR-1.json --format html --out receipt.html
offramp ui --profile profile.json --dir requests  # local web interface
```

For the request made on Friday 30 October 2026 at 10:00 in Vilnius, the
timeline shows: unfeasibility notice due by 20 November 2026 (14 working
days; 2 November is a public holiday in the example calendar), notice period
until 30 December 2026, transitional period 31 December 2026 to 29 January
2027, retrieval until 28 February 2027, erasure from 1 March 2027, and no
switching charges from 12 January 2027.

## How it maps to the law

| Provision | Rule | Offramp |
|---|---|---|
| [Art. 25(2)(d)](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32023R2854#art_25) | Notice period at most two months | Timeline; contract check in days and months |
| [Art. 25(2)(a)](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32023R2854#art_25) | Transitional period at most 30 calendar days, after the notice period; duties (i) to (iv) | Timeline; duty checks; notices |
| [Art. 25(4)](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32023R2854#art_25) | Unfeasibility notice within 14 working days; alternative period at most seven months | Working-day deadline; cap; notice document |
| [Art. 25(5)](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32023R2854#art_25) | Customer extends once | Lifecycle rule; confirmation document |
| [Art. 25(2)(g), (h)](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32023R2854#art_25) | Retrieval at least 30 calendar days; erasure afterwards | Timeline; erasure confirmation |
| [Art. 25(2)(c), 25(3)](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32023R2854#art_25) | Termination; switch to provider, on-premises or erase | Request targets; termination milestones |
| [Art. 25(1), (2)(b), (e), (f), (i)](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32023R2854#art_25) | Contract content | Contract checker |
| [Art. 26](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32023R2854#art_26) | Procedures, methods, formats, online register | Checker; information pack |
| [Art. 28](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32023R2854#art_28) | Jurisdiction and access-measures information | Checker; information pack |
| [Art. 29](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32023R2854#art_29) | Reduced charges until 11 January 2027 up to directly linked costs; none from 12 January 2027; charge information | Charge checks |
| [Art. 30](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32023R2854#art_30) | Functional equivalence (IaaS); open interfaces free of charge; machine-readable export | Checker |
| [Art. 31](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32023R2854#art_31) | Custom-built and non-production services | Regimes; skipped checks |
| [Art. 34(2)](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32023R2854#art_34) | Egress for in-parallel use at cost | Charge checks |
| [Art. 50](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32023R2854#art_50) | Applies from 12 September 2025 | Date checks |

[LEGAL.md](LEGAL.md) has the full mapping, the quotations and every
interpretation choice: how periods and working days are counted (the Data Act
does not say), which time zone applies, when the retrieval period starts, and
how 12 January 2027 is treated.

## Command line

```text
offramp profile check <profile.json> [--format text|json] [--fail-on conflict|missing|review|never] [--github-output]
offramp profile example [--out FILE]
offramp schema profile|request
offramp request create --profile P --id ID --customer NAME --service ID[,ID] --target provider|on-premises|erase [...]
offramp request event <request.json> --profile P --type TYPE [--at TIME] [--reasons TEXT] [--until DATE]
offramp request charge <request.json> --profile P --id ID --kind KIND --amount MINOR --imposed-on DATE [--cost MINOR]
offramp request validate|export|import <file> [...]
offramp timeline <request.json> --profile P [--now TIME] [--format text|json]
offramp docs <kind> --profile P [--request R] [--format md|html|json] [--out FILE]
offramp ui --profile P --dir DIR [--host 127.0.0.1] [--port 4791]
```

`offramp --help` lists every option. Exit codes: 0 success, 1 findings at or
above `--fail-on` (or a conflicting charge), 2 invalid input. Times are
`2026-03-01`, `2026-03-01T09:30` (profile time zone) or
`2026-03-01T09:30+01:00`; wall-clock times that a daylight-saving change makes
ambiguous are refused. Output files are created with mode 0600 and never
overwritten without `--force`.

Event types: `unfeasibility-notified` (with `--reasons` and `--until`, the last
day of the alternative period), `customer-extension` (with `--until`),
`transition-started`, `switching-completed`, `erasure-confirmed`
(`--scope`), `cancelled` (`--reason`).

Document kinds: `information-pack`, `switching-plan`, `receipt-notice`,
`unfeasibility-notice`, `extension-confirmation`, `completion-notice`,
`erasure-confirmation`.

## Web interface

```sh
offramp ui --profile profile.json --dir requests
```

Opens on `http://127.0.0.1:4791` and prints a one-time login link. Record
requests, see their timelines, record events and charges, and download
documents. Requests are stored as one JSON file each in the folder you name.
The interface uses no JavaScript and no external assets. It listens on
loopback only unless you pass `--allow-non-loopback` together with
`--allowed-host`; do that only behind a TLS reverse proxy on a trusted
network.

## Library

<!-- example:library -->
```ts
import { checkProfile, computeTimeline, createRequest, EXAMPLE_PROFILE, generateDocument, renderDocument, validateProfile } from '@afkzona/offramp';

const profile = validateProfile(EXAMPLE_PROFILE);
const report = checkProfile(profile);
console.log(report.summary);

const request = createRequest(profile, {
  id: 'SR-1',
  customer: { name: 'Example Customer UAB' },
  serviceIds: ['crm'],
  target: { kind: 'provider', providerName: 'Destination Cloud' },
  receivedAt: '2026-10-30T08:00:00.000Z',
});

const timeline = computeTimeline(profile, request, { now: Date.parse('2026-11-08T12:00:00Z') });
if (timeline.unfeasibilityNoticeDue !== '2026-11-20') throw new Error('14 working days');
if (timeline.transition?.lastDay !== '2027-01-29') throw new Error('30 calendar days');
if (timeline.retrieval?.lastDay !== '2027-02-28') throw new Error('retrieval');

const html = renderDocument(generateDocument('switching-plan', profile, request, { now: Date.parse('2026-11-08T12:00:00Z') }), 'html');
if (!html.includes('Offramp by AFKzona Group')) throw new Error('attribution');
```

Main functions: `validateProfile`, `validateRequest`, `checkRequestAgainstProfile`,
`checkProfile`, `createRequest`, `addEvent`, `computeTimeline`,
`checkChargeSchedule`, `checkAppliedCharges`, `generateDocument`,
`renderDocument`, `exportRequest`, `importRequest`, `startUi`. All are pure
except `startUi`. They throw `OfframpError` with a JSON path for invalid input.

## JSON Schemas

[`schema/provider-profile.schema.json`](schema/provider-profile.schema.json)
and [`schema/switching-request.schema.json`](schema/switching-request.schema.json)
(draft 2020-12) let other tools produce Offramp files. They are also exported
as `@afkzona/offramp/schema/provider-profile.schema.json`. The TypeScript
validators are the reference and are a little stricter (calendar dates must
exist, time zones must be known, identifiers unique, references resolved).
[`examples/`](examples) has a complete profile and a request.

## Request export and import

```sh
offramp request export SR-1.json --out SR-1.offramp.json
offramp request import SR-1.offramp.json --profile profile.json --out SR-1.json
```

The export wraps the request in an envelope (`offramp/switching-request-export`)
with the SHA-256 of its canonical JSON. Import verifies the digest, validates
the request, checks it against the profile, and warns when the profile changed
since the request was created. The digest detects changes and truncation; it is
not a signature.

## GitHub Action

```yaml
- uses: afkzonagroup/offramp@v0.1.0
  id: offramp
  with:
    profile: compliance/offramp-profile.json
    fail-on: conflict          # conflict | missing | review | never
- run: echo "Findings: ${{ steps.offramp.outputs.findings }}"
```

Outputs: `conflicts`, `missing`, `review`, `findings` (integers from the
current run). The profile must be inside the workspace. Pin the action to a
commit SHA in your workflows.

## Configuration: the provider profile

| Field | Meaning |
|---|---|
| `provider` | `name` (required), `legalName`, `website`, `contactEmail`, `switchingContact` |
| `timeZone` | IANA time zone in which calendar days are counted (required) |
| `workingDays.publicHolidays` | Dates excluded from working days (the Data Act does not say whose; name the calendar in `calendarName`) |
| `services[]` | `id`, `name`, `deliveryModel` (`iaas`, `paas`, `saas`, `other`), `regime` (`standard`, `custom-built`, `non-production`), `exportableData`, `digitalAssets`, `exemptedData`, `interfaces`, `switchingMethods`, `knownRestrictions`, `standards`, `functionalEquivalence`, `unbundling`, `freeTier`, `estimatedSwitchingTime`, `complexSwitchingInfo` |
| `contract` | Flags for each clause of Art. 25, `noticePeriod` (`{ "unit": "months", "value": 2 }`), `transitionDays`, `retrievalDays`, Art. 25(4) values, `clauseRefs` |
| `information` | Art. 26 procedures and register, Art. 29(4) pre-contract information, `chargesInformationUrl`, Art. 31(3) |
| `internationalAccess` | Art. 28(1) jurisdictions and web pages |
| `charges` | `currency` and `items` with `kind`, `amountMinor` (minor units), `directlyLinkedCostMinor`, `costBasis`, `appliesFrom`, `appliesUntil` |

Absent fields are reported as "not stated", never assumed.

## Limitations

- Offramp checks the information it is given. It cannot see the actual
  contract, the services or the costs, and it does not give legal advice.
- It covers Chapter VI (switching) only; see LEGAL.md for what is out of
  scope (other chapters, Art. 34(1), standards publication, national rules).
- Whether a service is custom-built, whether a cost is directly linked to
  switching, and whether functional equivalence is reached are for the
  provider to establish.
- Texts are written in English. They are not official texts; no translations
  are included.
- The working-day deadline uses the public holidays you list.

## Security

Inputs are validated with allow-lists and size limits; documents escape every
value and carry a strict Content Security Policy; the web interface binds to
loopback, uses a one-time login token, CSRF tokens, Origin, Host and
Fetch-Metadata checks and no JavaScript. See [SECURITY.md](SECURITY.md) for the
threat model and how to report a vulnerability.

## Dependencies

None at run time. Development uses TypeScript, ESLint with typescript-eslint,
Vitest with V8 coverage, and Ajv (only in tests, to check the JSON Schemas
against the validators). Versions are pinned exactly in `package.json` and
`package-lock.json`.

## Licence and Enterprise

Offramp is licensed under the [GNU AGPL v3](LICENSE) with an
[attribution term](LICENSE-ADDITIONAL-TERMS.md): interfaces and generated
documents keep "Offramp by AFKzona Group" with a link to
<https://afkzonagroup.lt>. A [commercial licence](COMMERCIAL.md) without the
AGPL obligations, and with white-label documents, is available.

MB AFKzona Group offers a commercial licence for organisations that cannot
use the AGPL-3.0 terms (including white-label use without the attribution
notice), integration into your systems, custom connectors and features, and
support agreements. Contact info@afkzonagroup.lt.

"Offramp" is a trademark of MB AFKzona Group; see [TRADEMARKS.md](TRADEMARKS.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Pull requests require the
[CLA](CLA.md).

## Disclaimer

Offramp is not legal advice. Its results depend on the information you give
it, and they do not establish that anyone meets Regulation (EU) 2023/2854.
Check the official text and your contracts, and take legal advice where
needed.

Maintained by AFKzona Group.
