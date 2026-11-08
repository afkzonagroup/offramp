# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub Security Advisories:
<https://github.com/afkzonagroup/offramp/security/advisories/new>. Do not open
a public issue. If you cannot use GitHub, email info@afkzonagroup.lt.

Include the version, what you did, what happened, and a minimal example
**without real customer data**. We aim to acknowledge reports within five
working days and to agree a disclosure date with you.

Supported versions: the latest release.

## Threat model

### Assets

- **Switching requests**: customer names, contact e-mails, contract
  references, the chosen data and the dates of a commercial relationship.
  Business data that can include personal data of contact persons.
- **The provider profile**: contract terms and charges; mostly public, but a
  wrong profile leads to wrong statutory dates.
- **Generated documents** sent to customers: their dates and statements
  matter legally.
- **The user's machine**: the files the CLI and the local UI read and write,
  the terminal, and the browser that opens the UI.

### Actors

- The **provider's or customer's staff** who run Offramp (trusted, may make
  mistakes).
- A **hostile file**: profiles and request exports travel between companies.
  A file may try to exhaust memory, pollute prototypes, inject markup into
  documents, inject terminal escape sequences, or spoof text with
  bidirectional characters.
- A **hostile web page** open in the same browser as the local UI, trying
  cross-site request forgery, DNS rebinding or framing.
- **Other local users or processes** on a shared machine.
- A **hostile contributor** proposing code changes.

### Trust boundaries

1. Profile and request files → validators.
2. Validated data → documents (Markdown, HTML, JSON) opened by people and
   other tools.
3. The browser ↔ the local UI server (HTTP on a loopback address).
4. Command line arguments and GitHub Action inputs → the file system and
   `$GITHUB_OUTPUT`.
5. Contributions → the released package.

### Mitigations

| Threat | Mitigation | Test |
|---|---|---|
| Oversized or deeply nested JSON | 1 MiB file and document limit checked before reading; nesting limit 32; length limits on every string; item limits on every list | `validate.test.ts`, `cli.test.ts` |
| Prototype pollution | `__proto__`, `constructor` and `prototype` keys rejected while parsing; objects rebuilt from allow-listed keys | `validate.test.ts`, `connectors.test.ts` |
| Unexpected fields, wrong types | Hand-written validators with allow-lists; unknown properties are errors; the JSON Schemas are checked against the same cases | `validate.test.ts`, `connectors.test.ts` |
| Spoofed text (Trojan Source style) | Control, zero-width, bidirectional and separator characters rejected in every text field | `validate.test.ts` |
| Markup injection in documents | Documents are built as data; HTML renderer escapes every value (`& < > " ' \` =`); links only for `http(s)` URLs; Markdown renderer escapes link, emphasis, table and block syntax and turns `< > &` into entities | `docs.test.ts` |
| Script in HTML documents | Each document carries a CSP: `default-src 'none'`, the stylesheet allowed only by its SHA-256, no scripts, no images, no forms, no base URL; served by the UI with `frame-ancestors 'none'` and `sandbox` | `docs.test.ts`, `ui.test.ts` |
| Cross-site request forgery on the UI | Per-session CSRF token on every form, compared in constant time; `Origin` must equal the UI's own origin; `Sec-Fetch-Site` must be `same-origin` when sent; session cookie `HttpOnly; SameSite=Strict` | `ui.test.ts` |
| Unauthorised use of the UI by other local users or web pages | Binds to 127.0.0.1 by default and refuses other addresses unless `--allow-non-loopback`; one-time login token (256 bits) printed on the terminal; idle sessions expire after 8 hours | `ui.test.ts` |
| DNS rebinding | `Host` header must be one of the UI's own host names (or `--allowed-host`) | `ui.test.ts` |
| Clickjacking, script injection in the UI | No script at all; CSP `default-src 'none'; style-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`; `X-Frame-Options: DENY`; values escaped by a tagged template | `ui.test.ts` |
| Request floods, large bodies | Rate limiter per server instance (300 requests per minute per address by default, pluggable); 64 KiB body limit checked on `Content-Length` and while reading; 200 form fields; header and request timeouts; connection closed after an early refusal | `ui.test.ts` |
| Wrong content types | Only `application/x-www-form-urlencoded` accepted for POST; invalid UTF-8 refused | `ui.test.ts` |
| Information leaks in errors | Unknown errors become "Unexpected internal error."; no stack traces to clients or the terminal | `ui.test.ts`, `cli.test.ts`, `validate.test.ts` |
| Path traversal via request ids | Request ids match `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`; file names are built only from validated ids inside the data folder | `ui.test.ts` |
| Symbolic link and overwrite attacks on files | Files are opened with `O_NOFOLLOW` and read through one handle; new files are created with `O_EXCL` (no overwrite without `--force`); replacements are written to a temporary file and renamed, never through a link; files mode 0600, the data folder 0700 | `cli.test.ts`, `ui.test.ts` |
| Lost updates in the UI | Every form carries the request's revision (SHA-256); a changed file is refused with 409 | `ui.test.ts` |
| Terminal escape injection | Every value, file name and message printed by the CLI is made printable (`\u{..}` escapes) | `cli.test.ts` |
| Injection through GitHub Action inputs | Inputs reach the script only as environment variables and separate arguments; the profile path must be relative to the workspace, without `..` segments; `$GITHUB_OUTPUT` receives only integer counts from the current run's result | `repo.test.ts`, `cli.test.ts` |
| Tampered request exports | SHA-256 of the canonical request in the envelope, verified on import. This detects changes and truncation; it is not a signature | `connectors.test.ts` |
| Data leaving the machine | No network client code anywhere (checked); the UI server only listens; no telemetry; no external assets in pages or documents | `repo.test.ts` |
| Supply chain | Zero runtime dependencies; exact development dependency versions; lockfile; no install scripts; `ignore-scripts=true`; actions pinned to commit SHAs; CI read-only | `repo.test.ts` |

### Data flows

The CLI reads the files you name and writes only the files you ask for (or
prints to the terminal). The local UI keeps requests as one JSON file each in
the folder you pass with `--dir`, and nothing else. Nothing is sent anywhere.
Documents are files you send yourself.

### Residual risks

- Anyone who can read the data folder can read the requests. Keep it on an
  encrypted disk and limit access; Offramp creates it with mode 0700.
- The revision check of the UI narrows but does not close the window between
  checking and replacing a file when the CLI and the UI change the same
  request at the same moment.
- Markdown viewers may turn plain URLs in text into links. The text is
  escaped, so no other markup is possible.
- `--allow-non-loopback` exposes the UI to the network. Put it behind a TLS
  reverse proxy and an authenticated network; the one-time token is the only
  login.
