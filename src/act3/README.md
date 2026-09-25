# Caldova workforce decision — Act 3

Act 3 reuses a retained synthetic colleague lesson for a new staffing decision,
checks that lesson against current Azure SQL policy and capacity, and records
separate operations and HR approvals.

Read the [Act 3 architecture](../../docs/act3.md) before combining this component
with the Fabric or standalone Act 2 scenarios.

## Component map

| Path | Purpose |
| --- | --- |
| `functions.mjs` | Azure Functions host, API routes, static assets, and Entra configuration |
| `staffing-api.ts` | Assessment, proposal, approvals, plan publication, and receipt orchestration |
| `staffing.ts` | V3 memory validation and applicability rules |
| `staffing-dataset.ts` | Deterministic December case derivation |
| `staffing-extension.json` | Authored workforce assumptions and colleague narrative |
| `staffing-scenario.json` | Generated and checked Act 3 scenario |
| `sql/` | Azure SQL schemas, procedures, policies, and integration checks |
| `web/staffing.*` | Presenter browser experience |

## Start here

Run all commands from the repository root:

```sh
npm ci
npm run demo:prepare
```

This validates the generated scenario, runs local tests, previews the V3 memory and
a separate rehearsal case without cloud access, checks configuration names, builds
`build/act3-deploy`, and audits that package.

Follow [Act 3 instructions](../../instructions/act3.md) for resources, identity,
seed, deployment, presenter preflight, and rollback behavior. For an AI coding
agent, use the [Act 3 agent runbook](../../instructions/act3-copilot.md).

## Demo behavior

- Azure setup, seeding, deployment, and verification are covered by
  [Act 3 instructions](../../instructions/act3.md).
- V3 Cosmos memory is create-once. An existing ID, conflicting content, timeout,
  or uncertain result stops without overwrite or automatic retry.
- Use a new `SESSION-` or `REHEARSAL-` case for each rehearsal.
- Checked-in business records are synthetic. Run preflight and the signed-in
  browser flow against the deployed app before presenting.

## Validation

```sh
npm test
npm run test:browser
npm run security:publication
```

See [the security review](../../docs/act3-security-review.md) for the complete
validation record.
