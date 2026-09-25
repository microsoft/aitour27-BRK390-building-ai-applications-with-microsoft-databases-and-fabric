# Repository instructions for coding agents

This repository contains the full BRK390 session. The publication responsibility
covered here is the Act 3 demo under `instructions/act3.md`, `docs/act3.md`,
`infra/act3/`, `scripts/act3/`, `src/act3/`, and the directly related tests and
SQL runtime file.

## Start here

1. Read `docs/act3.md` and `instructions/act3.md`.
2. Read `.github/skills/caldova-demo/SKILL.md`.
3. Keep `data/scenario.json` frozen and derive the December staffing scenario
   through `scripts/act3/build-staffing-scenario.mjs`.
4. Use Node.js 24 or later. TypeScript runs through native type stripping; do
   not add a TypeScript compilation step.

## Safety boundary

- Treat every business record as synthetic and every calculated result as a
  fixture unless retained tenant evidence proves an observed run.
- Do not print or commit `.env`, `local.settings.json`, Azure CLI state, tokens,
  tenant IDs, account IDs, receipts, screenshots, recordings, or build output.
- Do not provision, seed, assign roles, deploy, change Function settings, or run
  authenticated cloud checks without explicit resource-owner authorization for
  the exact target and command.
- Never weaken token validation, role checks, source hashes, SQL parameterization,
  create-once memory semantics, idempotency, or uncertain-write handling.
- Never overwrite the V3 Cosmos source or reset an approved case. Create a new
  `SESSION-` or `REHEARSAL-` case for another run.

## Local completion gate

Run:

```sh
npm ci
npm run demo:prepare
npm run test:browser
npm run security:publication
```

The deployment package is written to `build/act3-deploy`. Azure deployment and
post-deployment preflight are separate owner-run steps.
