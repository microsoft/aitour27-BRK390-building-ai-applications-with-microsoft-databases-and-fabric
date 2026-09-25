---
name: caldova-demo
description: "Use when: configuring, deploying, rehearsing, debugging or changing the Caldova staffing demo, Azure Function or demo preflight."
---

# Caldova Demo

Read [the Act 3 architecture](../../../docs/act3.md) and
[deployment instructions](../../../instructions/act3.md). Work from the repo root.

1. Use the December staffing workflow and keep its case and evidence boundaries
   separate from the earlier production-review experience.
2. Keep `data/scenario.json` frozen. Derive staffing from its separate extension;
   run `npm run demo:scenario:check` after any relevant change.
3. Diagnose with the owning handler, a nearby regression test and sanitized telemetry.
   A static HTTP 200 is not dependency readiness. Do not weaken authentication.
4. Require explicit subscription, tenant, Function, SQL, Cosmos and embedding settings.
   Prefer managed identity. Never copy values from private `.azure/` records into code.
5. Run `npm test` before packaging. The package is built with
   `npm run demo:package` using `npm ci` and a dependency audit.
6. Cloud deployment, provisioning, role assignments, seed and SQL verification are
   mutations requiring owner authorization. Transaction rollback is still a mutation.
   Do not run them merely to prove local tests pass.
7. The protected preflight verifies actual SQL and Cosmos reads plus quota headroom.
   It does not certify interactive speaker login, embeddings or paused-database resume.
8. Never replay uncertain writes. Preserve request IDs, compare receipts and context
   hashes, and use separate case IDs for rehearsals instead of resetting approvals.
9. Before sharing, use [demo-security-review](../demo-security-review/SKILL.md).

Describe fictional data, authored assumptions, calculated forecasts and observed
execution accurately. A fixture is not a live run and an approval is not a hiring action.