# Contributing

Thank you for helping. Offramp produces statutory dates and documents that
customers rely on, so correctness and security come first.

## Before you start

- Open an issue to discuss larger changes.
- Pull requests require the [Contributor Licence Agreement](CLA.md). Add the
  signature line from CLA.md to your first pull request.
- Follow the [Code of Conduct](CODE_OF_CONDUCT.md).
- Never put real customer data in issues, tests or fixtures. Use invented
  names and example.com addresses.

## Development

```sh
npm ci
npm run check        # typecheck + lint + build + tests with coverage
npm run schema:write # regenerate schema/ and examples/ after model changes
```

Requires Node.js 22.18 or later for `npm run schema:write` (the script is
TypeScript run directly by Node).

## Rules

- TypeScript strict mode, no `any`, no `@ts-ignore`; `eslint-disable` only
  with a written reason.
- No runtime dependencies.
- Every rule cites the article of Regulation (EU) 2023/2854 it comes from
  (`src/legal/refs.ts`), taken from the official text on EUR-Lex. Never cite
  secondary sources for what the law says. Where the text leaves room,
  document the reading in LEGAL.md.
- Every rule and every period needs tests, including the boundary days.
- Every security control needs a test that fails when the control is
  removed.
- Messages never say that anyone is "compliant".
- Keep the attribution "Offramp by AFKzona Group" in interfaces and
  documents (LICENSE-ADDITIONAL-TERMS.md).
- Update CHANGELOG.md.
