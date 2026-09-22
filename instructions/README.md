# Attendee instructions

These instructions deploy the synthetic Caldova estate and run the BRK390 demos
in a public Microsoft Fabric environment. Use an empty or disposable
demonstration workspace. Review every command against your tenant's permissions
and governance requirements before execution.

## What you will deploy

The root scripts create or resolve these items:

| Fabric item | Default name | Purpose |
|---|---|---|
| Lakehouse | `CaldovaAnalytics` | Analytical Delta tables, dashboard tables, evidence files, evaluation assets, and receipts. |
| Eventhouse and KQL database | `CaldovaSignals` | Sales, forecast, campaign, weather, inventory, and production time series. |
| Fabric SQL Database | `CaldovaOperations` | Relational operational data, policies, plans, governed actions, and decision memory. |
| Fabric IQ ontology | `CaldovaBusinessMeaning` | Governed entities, relationships, and source bindings. |
| Direct Lake semantic model | `CaldovaLaunchModel` | Measures and analytical grounding for dashboards and agents. |
| Fabric data agent | `CaldovaAnalyst` | Grounded analysis across the semantic model, KQL database, and Lakehouse. |
| Cosmos DB for NoSQL database | `CaldovaDecisionMemory` | Optional document storage enabled with `--with-cosmos`. |

The deployment does not create an Azure SQL logical server, Azure Database for
PostgreSQL, or Azure HorizonDB. Fabric SQL Database uses the Azure SQL Database
engine as a Fabric item.

## Prerequisites

- Node.js 24 or later. The data tools run TypeScript directly with native type
  stripping.
- The [Fabio CLI](https://github.com/iemejia/fabio), version 0.71.0 or later.
- Bash on macOS/Linux, or PowerShell 7 or later on Windows.
- A Microsoft Fabric workspace and permissions to create, read, update, and
  load the item types listed above.
- A disposable workspace or a workspace containing only resources created for
  this demo.
- For the Caldova Insights app, npm and permission to deploy a Fabric data app
  with Rayfin.

No credentials, tenant identifiers, or workspace-specific configuration are
stored in this repository.

## 1. Verify the synthetic dataset

From the repository root, verify the committed payload before making tenant
changes:

```bash
node data/tools/manifest.ts --check
node data/tools/validate.ts
```

The manifest check verifies the committed files and hashes. The validator
recomputes the scenario invariants, relationships, stage-critical values, and
Fabric item metadata.

The default dataset stops on the decision day, `2026-08-03`. The recommended
campaign has not been approved, the hero decision case remains open, and no hero
actions or receipts exist yet. This is the correct state for the live demos.

To generate the optional outcome slice locally:

```bash
cd data
node tools/generate.ts --with-outcome
node tools/validate.ts
node tools/manifest.ts
cd ..
```

Do not deploy the outcome slice before the session unless you want the agent to
see the approved commitment, actions, receipts, correction, and outcomes.
Regenerate without `--with-outcome` to restore the undecided state.

## 2. Authenticate and verify the workspace

Sign in to Fabio:

```bash
fabio auth login --browser
```

Confirm that the current identity can see the intended workspace:

```bash
fabio workspace show --id <workspace-id> -o table
```

You can pass either a workspace ID or display name to the root scripts. Prefer
the immutable workspace ID for repeatable runs.

## 3. Preview the deployment

Always start with a dry run:

```bash
./create-data.sh --workspace <workspace-id> --dry-run
```

PowerShell:

```powershell
pwsh ./create-data.ps1 --workspace <workspace-id> --dry-run
```

Review the target names and every printed Fabio command. A dry run performs
local preparation and validation but makes no remote changes.

## 4. Deploy the Fabric estate

Bash:

```bash
./create-data.sh --workspace <workspace-id>
```

PowerShell:

```powershell
pwsh ./create-data.ps1 --workspace <workspace-id>
```

The scripts load the SQL, KQL, Lakehouse, ontology, semantic-model, and
data-agent surfaces in dependency order, then run post-load verification.
Compressed CSV files are expanded automatically into the ignored
`data/.staging/` directory.

Useful options:

| Option | When to use it |
|---|---|
| `--prefix <value>` | Use a different item-name prefix. |
| `--capacity <value>` | Supply a capacity when the script must create a missing workspace. |
| `--regenerate` | Regenerate the local dataset before validation and deployment. |
| `--overwrite` | Intentionally replace or reload existing target data. |
| `--verify-only` | Re-run post-load verification against existing items. |
| `--with-cosmos` | Create the Cosmos DB item, containers, and decision-case documents. |
| `--skip-fabric-items` | Load the data estate without the ontology, semantic model, or data agent. |
| `--evaluate-agent` | Run the published data-agent evaluation questions after deployment. |

Run `./create-data.sh --help` or
`pwsh ./create-data.ps1 --help` for the complete option list.

Without `--overwrite`, the scripts protect non-empty target tables rather than
silently duplicating records. Use `--overwrite` only after confirming that the
workspace contains disposable demo data.

## 5. Verify the deployed demos

Re-run the script in verification mode:

```bash
./create-data.sh --workspace <workspace-id> --verify-only
```

For the data-agent evaluation:

```bash
./create-data.sh \
  --workspace <workspace-id> \
  --verify-only \
  --evaluate-agent
```

You can also review the authored evaluation prompts and expected facts in:

- [`data/evaluation/questions.json`](../data/evaluation/questions.json)
- [`data/evaluation/expected-results.json`](../data/evaluation/expected-results.json)

The four session demos cover:

1. Demand and weather evidence for Hydration Sunscreen.
2. A governed campaign recommendation that still requires human approval.
3. A production-capacity conflict and policy-constrained operating plan.
4. Decision memory that preserves evidence, actions, corrections, and outcomes.

Detailed model and agent references are available in:

- [`src/fabric/CaldovaLaunch.DataAgent/README.md`](../src/fabric/CaldovaLaunch.DataAgent/README.md)
- [`src/fabric/CaldovaLaunch.Ontology/README.md`](../src/fabric/CaldovaLaunch.Ontology/README.md)
- [`src/fabric/CaldovaLaunch.SemanticModel/README.md`](../src/fabric/CaldovaLaunch.SemanticModel/README.md)

## 6. Configure and deploy Caldova Insights

The app in [`src/caldova-insights/`](../src/caldova-insights/README.md) is a
Fabric-embedded React dashboard with a Rayfin function that calls the published
data agent on behalf of the signed-in user.

Prepare the application:

```bash
cd src/caldova-insights
cp fabric.example.yaml fabric.yaml
npm install
```

Edit `fabric.yaml` with the deployed workspace and item IDs. The file is
gitignored and must not be committed. Generate the active Fabric profile and
build the app:

```bash
node node_modules/@microsoft/fabric-app-data-cli/dist/index.js use default -o src/fabric.generated.ts
npm run lint
npm test
npm run build
npm --prefix rayfin/functions run build
```

Deploy the app with the public Fabric workspace URL:

```bash
npx rayfin up --workspace-uri "https://app.fabric.microsoft.com/groups/<workspace-id>/list"
```

Read the published data-agent MCP URL:

```bash
fabio data-agent mcp-url --workspace <workspace-id> --id <agent-id>
```

Store that value as the app's `DATA_AGENT_MCP_URL` secret:

```bash
npx rayfin secret set DATA_AGENT_MCP_URL
```

The secret is specific to each deployed app item and workspace. It is not
carried across Fabric profile switches.

The app requires the Fabric portal embed for authentication and cannot be used
as a standalone local application. For layout-only work with fixture data:

```bash
npm run preview:layout
```

See the [Caldova Insights guide](../src/caldova-insights/README.md) for profile
switching, app architecture, and troubleshooting.

## Troubleshooting

- **Workspace not found:** verify the tenant, signed-in identity, workspace ID,
  and permissions with `fabio workspace show`.
- **Existing non-empty tables:** use a fresh workspace or review whether
  `--overwrite` is safe.
- **Semantic-model queries fail:** confirm the model was created and refreshed,
  and that the current identity can query it.
- **Data-agent queries are unavailable:** review tenant settings and preview
  feature availability. Item creation can succeed even when agent query is
  disabled by the tenant administrator.
- **App build cannot find `fabric.yaml`:** copy `fabric.example.yaml`, fill the
  public workspace/item values, and generate `src/fabric.generated.ts`.
- **Analyst assistant returns an endpoint error:** confirm
  `DATA_AGENT_MCP_URL` belongs to the same workspace as the deployed app.

## Reset and cleanup

The scripts do not delete Fabric items. For repeatable delivery, use a
dedicated disposable workspace and delete the created items or the entire demo
workspace after the session according to your tenant's governance process.

Remove local generated state when it is no longer needed:

- `data/.staging/`
- `src/caldova-insights/fabric.yaml`
- generated app build output and local dependency directories

Do not commit those files or any deployment state, credentials, tenant exports,
or customer data.
