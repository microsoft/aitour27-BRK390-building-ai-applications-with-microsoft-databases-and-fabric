# Dataset-Linked Act 3

## Sources

The existing shared dataset remains the open snapshot at `clock.asOf`.
The follow-on staffing scenario is generated separately; it does not change
the frozen opportunity, shortfall, maintenance or stress contracts.

| Input | Authority |
|---|---|
| Product, plant, line, persona and prior case | `data/scenario.json` |
| Earlier production approval and optional resolution | `data/scenario.json` |
| Baseline, conservative production ceiling, operating weekdays | `data/scenario.json` |
| New demand uplift, workforce availability and productivity model | `staffing-extension.json`, authored scenario assumptions |
| Notice and temporary-assignment rules | Generated versioned SQL policies, authored scenario assumptions |
| Reassignment narrative, packing productivity and holiday priority | Owner-authorized synthetic colleague narrative in `staffing-extension.json`; live Cosmos insertion/read still required |

`staffing-dataset.ts` derives planning time four calendar months after the earlier
production approval, a window three days later, and fourteen calendar days of
production with the shared non-operating weekdays removed. SQL counts the stored
operating dates, applies the shared daily baseline and ceiling, and includes the
calendar plus dataset provenance in the approval context hash.

The August 2026 scenario approval date therefore leads to December 2026, at the start
of Southern Hemisphere summer. The offset is measured from that authored date.
The owner's latest notes retain December, superseding the colleague brief's nine-month
interval. The staffing lesson is an 8% daily-output gain per qualified extra worker,
up to two extra workers and the existing production ceiling. The new demand is
committed in this separate fictional narrative. Protecting people's vacations and
published shifts motivates checking current policy before repeating reassignment.

## Build and Run

From the repository root:

```sh
node scripts/act3/build-staffing-scenario.mjs
node scripts/act3/build-staffing-scenario.mjs --check
node --test src/act3/staffing-dataset.test.ts
node --env-file=.env scripts/act3/apply-staffing.mjs
node --env-file=.env scripts/act3/seed-staffing.mjs
node --env-file=.env scripts/act3/verify-staffing.mjs
```

The last three commands require approved Azure SQL access and explicit cloud-write
opt-in. Seeding uses the configured embedding deployment and budget. See
[Act 3 instructions](../../instructions/act3.md) for setup and managed-identity
permissions.
No authentication-bypass rehearsal server is included in the public workflow.

The deployed app is `/api/staffing-app`.
Assess, inspect source and policy, compare options, submit, approve operations,
inspect the one-approval state, approve HR, and inspect the retained receipts.

Recordings and raw evidence remain private. Review metadata, account information
and every visible frame before sharing a separately approved capture.

Expected current totals are generated in `staffing-scenario.json`: 207,360
baseline, 227,360 demand and 233,280 planned units over twelve operating days.
Evidence checks the generated expected total and the source dataset hash.

Both seed and rehearsal fail if the generated contract is stale. Seeding is
insert-only. Revise the canonical case ID or policy version before seeding
changed facts under a previously used identifier; do not reset approvals.
Presentation tooling can consume this generated contract without duplicating numbers.

## Versioned Synthetic Act 2 Handoff

The original dataset describes the reduced-rate action and maintenance deferral;
it does not establish a worker reassignment or productivity observation. That story
is preserved. Schema version 3 explicitly introduces the owner's colleague narrative
as a separately authored source, not a correction to the original execution history.
The generator reads `priorAction`, `packingObservation` and `workforcePriority` from
the version 3 extension, never from the legacy maintenance or production action details.
Product, line, supervisor and timestamp are borrowed scenario anchors, not evidence
that the colleague action ran. No successful live execution is invented.

The new memory ID is `CASE-2026-HS-001-staffing-v3`, partitioned by
`CASE-2026-HS-001`; the canonical SQL case is `CASE-STAFFING-20261210-V3`.
The generator's `provenance` identifies `synthetic_colleague_narrative` and the
extension source, and retains the frozen dataset SHA-256 separately. The memory
itself requires `schemaVersion: 3`, `dataClass: "synthetic_colleague_narrative"`,
the existing source/narrative fields, `workforcePriority`, and structured
`productivity: {gainPerWorker: 0.08, maxExtraWorkers: 2}`. A canonical validation
projection hashes all these fields while discarding unknown policy-shaped properties.

Live setup is still an operational prerequisite: with owner authorization, create
the generated memory as a **new** Cosmos document in the approved container and
insert a new SQL case referencing it. Do not replace the old maintenance or packing
document, and do not reset an existing case. A wrapped document's `id` and `caseId`
must match the nested memory and SQL source reference. See
[deployment prerequisites and exact API contract](../../instructions/act3.md).

`POST assess` reads the current case and then the validated Cosmos lesson before
querying SQL options or embedding the policy question. Applicability requires exact
line, model and numeric productivity equality with current SQL. Missing/old-shaped
memory or a mismatch yields no assessment recommendation or proposal. SQL remains
the sole policy authority: the 21-day notice rule is not learned from Cosmos. The
existing policy scope, date, status, onboarding and per-approval commit checks stay
in force. Proposals and approvals reread Cosmos and bind its hash to the reviewed
SQL context; a changed lesson requires another review.

Each new deployment needs owner-approved Cosmos read permissions, approver roles,
Function SQL grants and interactive authentication verification.
`ACT3_STAFFING_CASE_ID` must be configured explicitly. This is fixed-tool
orchestration with embedding retrieval, not an autonomous planning agent.