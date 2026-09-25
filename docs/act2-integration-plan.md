# Act 2 contribution plan

## Latest owner-approved scope

After completing the additive import, the owner authorized local tests, navigation
updates and separate contribution commits. This supersedes the initial additive-only
restrictions below. The numerical variant decision is unchanged.

Completed validation in the destination:

- `uv sync --locked --group dev` completed using the imported lockfile.
- `uv run pytest -q`: 12 passed; three opt-in cloud tests skipped.
- `node --check app/static/app.js`: passed.
- `node data/tools/manifest.ts --check`: all 94 files matched.
- `node data/tools/validate.ts`: 322 passed, zero failed.

The root README, architecture/infrastructure/instructions indexes, and the existing
single delivery-resources README now link and distinguish the Act 2 variant.
No cloud resources or live data were changed during integration. The contribution
is organized as three implementation commits and a session documentation commit;
no push or pull request is included.

## Initial scope (historical; superseded above)

Import the tested Act 2 implementation from `aitour26-brk290-act2` into this
session repository. Preserve it as an explicitly separate scenario variant.
Use additive documentation only: do not edit existing authored landing pages,
the Fabric narrative contract, generated data, or the presenter README. Perform
static verification only; do not run project test suites or install dependencies.

The source repository remains intact. This integration does not deploy resources,
modify the running demos, commit, push, or create a pull request.

## Source provenance

Import tracked files from these source commits, in their existing final state:

| Commit | Component |
| --- | --- |
| `65e2ffd` | HorizonDB marketing decision, Cowork tools, evidence UI, and deployment |
| `79763d4` | Teams Factory Planning Agent, capacity calculations, and approval |
| `829b65f` | Cosmos DB decision memory and Agent Memory Toolkit processing |

Do not copy `.git`, `.venv`, local credentials, browser/session exports, generated
ZIP packages, caches, logs, or live database documents. Live deployment identifiers
are configuration, not part of the public contribution. Preserve their purpose
through environment variables and configuration templates.

## Destination structure

| Destination | Purpose |
| --- | --- |
| `src/caldova-decisions/` | Self-contained Python project for the three Act 2 components |
| `src/caldova-decisions/app/` | Campaign MCP tools, job worker, auth, and inspection UI |
| `src/caldova-decisions/factory_agent/` | Teams activity handling and deterministic factory planning |
| `src/caldova-decisions/decision_memory/` | Transactional capture and Cosmos toolkit integration |
| `src/caldova-decisions/sql/` | PostgreSQL schemas, fixtures, migrations, and checks |
| `src/caldova-decisions/infra/` | Component-owned Bicep templates, retaining script-relative paths |
| `src/caldova-decisions/scripts/` | Deployment, packaging, walkthrough, and verification commands |
| `src/caldova-decisions/plugin/` | Cowork skill and an example connection configuration |
| `src/caldova-decisions/demo/` | Executable walkthrough queries and supporting component reference |
| `src/caldova-decisions/tests/` | Imported tests, including explicitly opt-in cloud integration checks |
| `instructions/act2.md` | Additive deployment sequence for the standalone Azure services |
| `docs/act2.md` | Architecture, narrative boundary, limitations, and links |
| `infra/act2/README.md` | Index distinguishing Act 2 Bicep from the Fabric root deployment |

Keep one Python environment because the factory and memory components import
shared database helpers from the campaign service. Splitting them into unrelated
projects would require a packaging redesign unrelated to this import. Colocated
component infrastructure preserves the tested relative path layout; the root
infrastructure index exposes it without moving or duplicating templates.

## Narrative contract and boundaries

| Concern | Existing Fabric contract | Imported Act 2 variant |
| --- | --- | --- |
| Campaign investment | USD 180,000 candidate budget | USD 30,000 additional budget |
| Incremental units | 100,000 | 57,000 |
| Factory conflict | PKG-02, 57,920 shortfall | PKG-03, MW-77 days 6–10, 57,000 at risk |
| Production response | OPT-4 reduced-rate/high-utilisation maintenance deferral | Preserve maintenance; 22,800 units on PKG-01 and 34,200 on earlier PKG-03 slots |
| Regions | Coastal, Southern, Delta, Island, Northern, Central | North America, Europe, Asia Pacific, Latin America |
| Initial planning date | August 3, 2026 | September 17, 2026 |
| Memory reveal | Optional generated outcome slice | Real demo approval captured; actual production outcome pending |
| Cosmos surface | Optional Fabric-native database item | Azure Cosmos DB for NoSQL account and Agent Memory Toolkit |

Do not describe the 57,000 units as a numerical continuation of Fabric's 100,000
units or automatically map the region names. The conceptual transition is shared:
**see/understand → decide/act → remember**. The executable datasets are distinct.
Use the imported scenario consistently for the recorded slide-20/24/26 segment.
Retrieval and the next workforce decision remain Act 3; Demo 4 ends at retention.

## Initial implementation phases (historical)

### 1. Inventory and transfer

- Confirm both repositories have clean working trees before import.
- Transfer only Git-tracked source files beneath the new component directory.
- Record the three source commits above without rewriting destination history.
- Preserve all implementation modules, scripts, SQL, tests, Bicep and dependency lock.
- Remove source-environment configuration from the transferred tracked set; replace
  it with an example. Do not copy ignored secrets even for local convenience.

### 2. Public configuration

- Parameterize database hosts, Cosmos account/database, model endpoints/deployments,
  Azure resource groups, and Tim/Karin Entra object IDs.
- Make startup fail clearly when required deployment configuration is missing.
- Retain synthetic product/line names, fixed illustrative dates, and case IDs.
- Retain actual runtime approver identities in live data, but never embed the
  original tenant's identities or timestamps in public fixtures or documentation.
- Use an ignored `plugin/connection.json`, authored from `connection.example.json`.
- Remove machine-specific `/Users/...`, `~/msrepos/...`, expired tunnel URLs,
  subscription IDs, OAuth vault references, and trial/billing history from public docs.
- Update package/test references for the imported root without changing the original
  running deployment or its configuration.

### 3. Component documentation

- Replace historical setup transcripts with portable operational instructions.
- Explain each agent's role and distinguish model interpretation from deterministic
  calculations, approval validation, and database persistence.
- Keep prototype SQL documented as historical rather than the default deployment.
- Document explicit in-process memory processing, corpus-level provenance, and the
  known summary-transposition review; do not imply change-feed or retrieval has run.
- Provide PostgreSQL and Cosmos query entry points using business IDs, not recording
  names or live resource IDs.

### 4. Additive repository documentation

- Add the Act 2 architecture and setup pages and infrastructure index listed above.
- Link the existing Act 1 guide and contract from the new pages.
- Do not edit the existing root README, instructions README, docs README, data
  README, or delivery-resources README under the selected additive-only scope.
- Do not add another presenter guide under delivery-resources: that directory's
  single-README convention remains intact.

### 5. Static verification

- Verify the imported file inventory against `git ls-files` from the source.
- Check destination tracked-file diffs: existing authored files must be unchanged.
- Parse Python syntax, JSON configuration, TOML metadata and the lockfile without
  executing application modules or contacting clouds.
- Check local Markdown link targets in new documents and script-relative paths.
- Scan new files for original tenant/subscription/user IDs, live hostnames, vault
  references, local machine paths, private keys and credential literals.
- Verify ignore coverage for local config, generated artifacts and credentials.
- Record that tests and deployment were not run in the destination; prior source
  verification is evidence of the original implementation only.

## Completed contribution sequence

The destination contribution consists of these four commits, in narrative order:

1. `a560ae1`: Campaign decision and Cowork integration, with shared Python scaffolding.
2. `f8b4407`: Teams factory planning, schema, Bicep, tests and SDK dependency.
3. `29a3af9`: Cosmos memory, toolkit dependency, capture schema and Explorer queries.
4. `eb3a464`: Repository navigation, setup and presenter guidance.

Do not cherry-pick source commits at repository root: their paths and deployment
configuration are incompatible with the destination's public structure. Import
them under the component root and review the resulting contribution there.

## Remaining follow-up

Navigation, setup documentation and the single presenter guide were updated with
owner approval. [Session order](session-order.md) defines the canonical act/demo
mapping. No additional navigation approval is pending.

A later unification effort must select one numerical contract, update the relevant
generators and expectations, revalidate both workloads, and re-record any affected
segments. That is not part of this additive contribution.

## Implementation status

Completed the additive import under `src/caldova-decisions/` and the four new
repository reference/index pages. All 76 source-tracked file paths are accounted
for: 75 are present at the component-relative path and the live
`plugin/connection.json` is replaced by `plugin/connection.example.json`.
Component READMEs were reauthored to retain operational guidance while removing
tenant-specific run logs, expired trial information and machine paths. The original
source repository retains the full historical documentation and three commits.

Configuration changes are limited to the imported component: runtime endpoint
variables, required Tim/Karin deployment arguments, an ignored Cowork connection
file, configurable memory models, and explicit proposal selection for capture
verification. Fixed synthetic case/product/line data remains the tested variant.

Initial static verification completed before navigation edits and test authorization:

- Parsed 30 Python source files without executing modules.
- Parsed the connection JSON template, pyproject TOML and uv lockfile.
- Checked local links in 11 new Markdown files; no missing local targets.
- Confirmed source inventory coverage and that no existing tracked destination
  files were modified.
- Scanned new code/docs for original deployment UUIDs, tenant/account names,
  tunnel hosts and local machine paths; none remain. Template endpoint placeholders
  are intentional and must be configured by the deployer.
- Confirmed credentials, local connection JSON, virtual environments and generated
  distributions are ignored.

Subsequently, dependencies were installed from the lockfile, local component tests
and the existing Fabric validators passed, and the four commits above were created.
No generator regeneration, Azure deployment, push or pull request was performed.
The Fabric implementation and generated payload remained unchanged. Clean cloud
deployment and the opt-in integration checks remain the next validation phase.
