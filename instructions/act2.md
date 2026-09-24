# Deploy and run the Act 2 variant

Read the [scenario distinction](../docs/act2.md) first. This guide does not replace
the [Fabric setup](README.md), and root `create-data.sh` does not deploy Act 2.
Use disposable Azure resources and synthetic inputs. Run all commands below from
`src/caldova-decisions` after cloning this repository.

Sections 1–5 cover initial setup. Once your services are configured, follow
[Replay the full Act 2](#replay-the-full-act-2) below for the end-to-end presentation.
The replay uses **USD 30,000 / 57,000 additional units**, not the root Fabric
scenario's 100,000-unit campaign.

## Prerequisites

- Python 3.11 or later, `uv`, PostgreSQL `psql`, Azure CLI and Bicep.
- Azure subscription access to an available HorizonDB preview region.
- A Foundry/Azure OpenAI chat deployment and an embedding deployment for memory.
- Microsoft 365 demo tenant/users for Tim and Karin. Teams custom-app upload and
  Cowork access/OAuth must be configured; these are independent of Azure RBAC.
- HTTPS endpoints or Dev Tunnels for the Cowork server and Teams bot.
- Azure Cosmos DB for NoSQL account/database with operator data access for memory.

The component has a locked Python dependency set. Install it after reviewing the
dependency and deployment scope:

```sh
uv sync --locked --group dev
cp .env.example .env
```

Edit `.env` with your own endpoints and identities. Use `uv run --env-file .env`
for Python helpers. For `psql`, export PGHOST, PGDATABASE, PGUSER and PGSSLMODE in
your shell separately. Passwords should use a local protected `~/.pgpass` file.

## 1. Provision or configure HorizonDB

Follow [component infrastructure](../src/caldova-decisions/infra/README.md).
Use `scripts/deploy.py existing` for a shared demo cluster, or `new` for a new one.
Validate and inspect what-if before deploying. The source used Sweden Central;
check regional availability in your subscription. Applying preload configuration
can restart an existing cluster.

Connect to `postgres` and inspect required extensions:

```sh
psql -X -w -f sql/00-inspect.sql
psql -X -w -f sql/05-extensions.sql
uv run python scripts/register-model.py \
  --subscription YOUR_SUBSCRIPTION_ID \
  --resource-group YOUR_FOUNDRY_RESOURCE_GROUP \
  --account YOUR_FOUNDRY_ACCOUNT
uv run --env-file .env python scripts/deploy-database.py
```

The model helper's default chat deployment is `gpt-5.4-mini` and alias is
`caldova-chat`. Check your installed function signatures and model connectivity.
SQL files 50–60 define the current workflow; 10–40 are historical prototype files.

## 2. Campaign agent and approval

Follow the [Cowork guide](../src/caldova-decisions/plugin/README.md) to configure
the API, connector OAuth registration, HTTPS server and plugin ZIP. Copy
`plugin/connection.example.json` to ignored `plugin/connection.json`; do not commit
deployment identifiers or credentials.

For a database-only walkthrough before the client is configured:

```sh
uv run --env-file .env python scripts/walkthrough.py \
  --case-id HYDRATION-SUNSCREEN-CAMPAIGN-001 --approve
```

Expected: USD 30,000, 57,000 extra units, 18.0% rounded uplift, and production
confirmation required. Approval is an explicit final step and saves a commitment.
Subsequent runs need a fresh case ID. Use [query files](../src/caldova-decisions/demo/README.md)
to inspect AI Functions, deployed pipeline graphs and saved data.

## 3. Factory Planning Agent in Teams

After approving the campaign:

```sh
psql -X -w -f sql/70-factory-planning.sql
uv run --env-file .env python scripts/seed-factory.py \
  --case-id YOUR_APPROVED_CASE_ID --karin-id YOUR_KARIN_OBJECT_ID
```

Follow [factory setup](../src/caldova-decisions/factory_agent/README.md) to create
the bot registration and service principal, expose port 3978 via HTTPS and package
the Teams app. Supply both `--tim-id` and `--karin-id` to the setup helper. Add the
package to the shared team, not only Tim's personal apps.

Karin asks for capacity, then alternatives preserving maintenance and orders.
The expected 57,000-unit plan splits 22,800 onto PKG-01 and 34,200 onto PKG-03
three days earlier. Karin approves the exact returned proposal ID. Preserve it
for memory capture; don't assume the source environment's proposal number.

## 4. Prepare Cosmos memory containers

This path uses a standalone **Azure Cosmos DB for NoSQL account**, not the root
Fabric `--with-cosmos` database item. Create/select a serverless account with a
database named `caldova-act2-demo` (or set `COSMOS_DATABASE`). Through Azure Portal
or management-plane tooling, create:

| Container | Partition key |
| --- | --- |
| `case_records` | `/caseId` |
| `memories` | Hierarchical `/user_id`, `/thread_id` (MultiHash v2) |
| `memories_turns` | Hierarchical `/user_id`, `/thread_id` (MultiHash v2) |
| `memories_summaries` | Hierarchical `/user_id`, `/thread_id` (MultiHash v2) |

Keep automatic consistent indexing. Use no automatic expiration for the retained
decision. The source retention demo does not require vector indexes; configure
matching vector/full-text policies separately before claiming indexed retrieval.

Create toolkit support containers:

```sh
az deployment group create \
  --resource-group YOUR_COSMOS_RESOURCE_GROUP \
  --template-file infra/memory-support.bicep \
  --parameters accountName=YOUR_COSMOS_ACCOUNT databaseName=caldova-act2-demo
```

Grant the local operator **Cosmos DB Built-in Data Contributor** scoped to this
demo database and the required Foundry model-invocation role. Azure management
roles alone do not grant Cosmos data access. The toolkit uses Azure CLI credentials;
container creation must happen through the management plane before capture.

Set `COSMOS_ENDPOINT`, `COSMOS_DATABASE`, `MEMORY_MODEL_ENDPOINT`, and deployment
names in `.env`. The default embedding deployment is ada-002 with 1536 dimensions.

## 5. Capture and inspect the decision

```sh
psql -X -w -f sql/80-decision-memory.sql
uv run --env-file .env python scripts/capture-decision-memory.py --proposal-id N
uv run --env-file .env python scripts/verify-decision-memory.py \
  --case-id YOUR_APPROVED_CASE_ID --proposal-id N --quiet
```

Replace N with Karin's approved production proposal. For future approvals, install
SQL 80 before the approval and keep the `--watch` worker running. Backfill of an
already approved proposal is supported. No actual delivery outcome is fabricated.

Use [Cosmos queries](../src/caldova-decisions/demo/07-cosmos-memory.sql) in Data
Explorer, adjusting the example proposal number in document/thread/user IDs. Show
the case, source interaction, generated summary/facts, then outcome pending.
Do not show a new retrieval conversation in Demo 4.

## Replay the full Act 2

### Before opening the conversation

Complete the setup above, including Cosmos containers and model access. Sign in
to Cowork as Tim and to Teams as Karin, preferably using separate browser profiles.
Both users must be members of the shared demo team, with the Factory Planning
Agent installed **in that team**, not only in Tim's personal app list.

Open terminals at `src/caldova-decisions` and keep these processes running:

| Process | Command | Purpose |
| --- | --- | --- |
| Campaign server and worker | `uv run --env-file .env python scripts/run-cowork.py` | Serves MCP tools, processes evaluations and exposes the evidence UI |
| Campaign HTTPS tunnel | `devtunnel host YOUR_CAMPAIGN_TUNNEL_ID` | Makes the configured Cowork connector reachable |
| Factory HTTPS tunnel | `devtunnel host YOUR_FACTORY_TUNNEL_ID` | Makes the Teams bot endpoint reachable |
| Factory bot | Start after binding the approved case in Demo 3 below | Handles Karin's thread and approval |

Use your existing HTTPS hosting instead if you do not use Dev Tunnels. Verify
that the actual tunnel hosts match the Cowork connection and Azure Bot messaging
endpoint. Do not start duplicate server instances on the same ports.

Prepare the factory and capture schemas before the live approval:

```sh
uv run --env-file .env psql -X -w -v ON_ERROR_STOP=1 \
  -f sql/70-factory-planning.sql \
  -f sql/80-decision-memory.sql
```

The capture trigger queues an event; it does not process Cosmos memory by itself.
For a predictable recording, process that event explicitly in Demo 4. Alternatively,
run `scripts/capture-decision-memory.py --watch` in another terminal for automatic
background capture, but do not run both modes concurrently for the recording.

### Keep this handoff checklist

Record these values as the agent returns them. They are different identifiers:

| Value | Where it comes from | Where it is used next |
| --- | --- | --- |
| Campaign **case ID** | Cowork's evaluation result | Tim's Teams post, factory seeding/configuration, Cosmos verification |
| Agent **job ID** | `evaluate_campaign` result | Evidence UI and job-specific pipeline run inspection |
| Marketing **evaluation ID** | Reviewed campaign proposal | Tim's exact-version marketing approval |
| Production **proposal ID** | Factory agent's proposed revision | Karin's approval and memory capture |

Do not reuse a sample job ID or assume the production proposal will be number 6.
Cowork creates a business case ID automatically; carry that exact value forward.

### Demo 2 — Tim decides and approves

In Tim's Cowork session, enable Caldova Campaigns and ask:

> Using Caldova Campaigns, evaluate investing up to $30,000 more in Hydration
> Sunscreen over the next six weeks. Which regions should we prioritise, what
> additional demand should we expect, and what must production confirm?
> Do not approve the plan yet.

The agent queues the request and polls for the actual result. Present the
recommendation, evidence and assumptions before approving:

| Expected result | Value |
| --- | --- |
| Recommended scenario | Targeted |
| North America investment | USD 18,000 |
| Europe investment | USD 12,000 |
| Additional demand | 57,000 units |
| Total demand | 373,667 units |
| Uplift | 18.0%, rounded |
| Historical-response range | 50,400–63,600 additional units; not a probability |
| Production status | Confirmation required |

Open **View evidence and AI pipelines** from the agent's response, or use VS Code
to inspect the deployed definitions. For the exact runs behind this request:

```sql
SELECT links.pipeline_name, runs.id AS run_id, runs.status,
       runs.created_at, runs.completed_at
FROM caldova.agent_run_links AS links
JOIN df.instances AS runs ON runs.id = links.run_id
WHERE links.job_id = 'YOUR_JOB_ID'::uuid
ORDER BY runs.created_at;
```

Then Tim says:

> Approve the exact proposal you just presented and prepare Karin's production
> capacity review.

Confirm that marketing is **approved** and the production request is **queued**.
The plugin prepares a message for Karin; it does not deliver it to Teams.
Copy the returned case ID and the saved conversation starter.

**Database-only alternative:** use `scripts/walkthrough.py --case-id
HYDRATION-SUNSCREEN-CAMPAIGN-001 --approve` with `.env` loaded. This can replace
the Cowork portion for rehearsal, but it does not create an agent job or its run
links. Choose one path for the campaign rather than creating two approvals.

### Handoff — bind the factory agent to that approved case

Set the exact case ID returned by Cowork:

```sh
export CASE_ID='PASTE_THE_APPROVED_CASE_ID'
uv run --env-file .env python scripts/seed-factory.py \
  --case-id "$CASE_ID" --karin-id YOUR_KARIN_OBJECT_ID
```

In the ignored `.azure/local/factory-bot.json`, set **`FACTORY_CASE_ID`** to the
same value. Preserve all other values, especially credentials. The JSON value
must be the actual ID, not the literal string `$CASE_ID`.

For first-time bot provisioning, pass `--case-id "$CASE_ID"` to
`scripts/setup-factory-bot.py` along with its endpoint, resource group and Tim/Karin
object IDs. For an existing bot, editing the local configuration is enough.
Start or restart the bot to load that configuration:

```sh
uv run --env-file .env python scripts/run-factory.py
```

This binding is explicit: the factory agent does not discover the latest marketing
plan automatically. The seeding command requires an already-approved USD campaign.

### Demo 3 — Karin evaluates and approves production

In the shared Teams channel, Tim posts the saved handoff message. Include the
case ID so the audience and the agent can identify the commitment:

> Karin, I approved the Hydration Sunscreen campaign: $30,000 additional investment
> and 57,000 extra units over six weeks. Can production absorb this without
> affecting existing orders? Approved case: YOUR_APPROVED_CASE_ID.

Switch to **Karin's Teams session** and reply in that same thread. Select the
actual bot from the @mention suggestions; plain text naming the bot is insufficient.

> @Factory Planning Agent Can PKG-03 cover the approved campaign demand while
> protecting existing customer orders?

Expected: maintenance **MW-77 on days 6–10**, leaving **57,000 units at risk**.
Karin continues:

> @Factory Planning Agent Keep MW-77 in place and protect existing orders.
> What alternatives do we have?

Expected: **22,800 units on PKG-01, days 6–10**, plus **34,200 units on PKG-03,
days 3–5**. The agent supplies a production proposal number. Review the result,
then Karin sends the exact approval command, substituting that number:

> @Factory Planning Agent Approve production proposal N

The bot confirms approval in the thread. Only Karin's configured Teams identity
can approve. Save **N**, then verify in PostgreSQL:

```sql
SELECT id, case_id, approved_by, approved_at
FROM factory.proposals
WHERE case_id = 'YOUR_APPROVED_CASE_ID'
  AND approved_at IS NOT NULL;

SELECT line, SUM(units) AS units, MIN(day) AS first_day, MAX(day) AS last_day
FROM factory.allocations
WHERE proposal_id = YOUR_PROPOSAL_NUMBER
GROUP BY line
ORDER BY line;
```

The approval is the production commitment. It does not prove the units have already
been manufactured or delivered.

### Demo 4 — retain and show the decision

Process Karin's exact approved proposal. `CASE_ID` must still identify the same
campaign from Demo 2:

```sh
export PROPOSAL_ID=YOUR_PROPOSAL_NUMBER
uv run --env-file .env python scripts/capture-decision-memory.py \
  --proposal-id "$PROPOSAL_ID"
uv run --env-file .env python scripts/verify-decision-memory.py \
  --case-id "$CASE_ID" --proposal-id "$PROPOSAL_ID" --quiet
```

If a watch worker already completed it, capture returns `already_completed`.
Check that processing succeeded before recording the memory views. Model-derived
text still requires review; do not show missing or incorrect outputs as completed.

Open your configured Cosmos DB account and database in **Data Explorer**. Derive
these filter values from the same case and proposal:

- Decision document ID and `thread_id`: **`<CASE_ID>:production-<PROPOSAL_ID>`**.
- Toolkit `user_id`: **`caldova-case-<PROPOSAL_ID>`**.
- Business document partition key `caseId`: **`<CASE_ID>`**.

Show the containers in this order:

1. **`case_records`:** trigger, Karin's judgment, approved allocation and approval.
2. **`memories_turns`:** source interaction and explicitly labeled business context.
3. **`memories_summaries`:** the Agent Memory Toolkit's condensed account.
4. **`memories`:** individual extracted facts and their provenance.
5. Return to **`case_records`:** plan approved, actual production outcome pending.

Use `demo/07-cosmos-memory.sql`, replacing **both** its example case ID and proposal
number in every filter. The memory verification helper supports these arguments;
`scripts/inspect-memory.py` remains a convenience query for the original example
and should not be used to identify a different replay case.

End at **Remember**. Do not demonstrate retrieval in another Teams conversation;
that is reserved for Act 3. Counter and lease containers are infrastructure and
are not part of the business narrative.

### Replay completion and a second run

A successful replay leaves one connected chain:

**Approved marketing evaluation → production case → Karin's approved proposal →
saved allocations → Cosmos decision document and toolkit memories.**

Before a second replay, remember that factory approval reserves capacity. A new
case ID alone does **not** free those slots. The simplest repeatable approach is a
fresh disposable database environment with the same fictional fixtures. Otherwise,
prepare a deliberately separate planning window/capacity fixture. Do not silently
delete approved decisions or overwrite allocations to make the old answers recur.

The fixture dates are fixed planning dates, not today's calendar. Keep them aligned
across the market facts and request; do not change only the displayed date.

## Verification and cleanup

The imported component passes 12 local tests, and the existing Fabric dataset passes
322 validation checks with its 94-file manifest intact. Three cloud integration
tests were skipped. Prior source live-demo verification is not proof that your new
deployment is ready. Before delivery, run service-specific checks against your
environment. Live tests create data and some record approvals.

Stop local servers, outbox workers and tunnels after use. Remove only Azure resources
and Entra registrations created for your deployment; do not delete shared accounts
or approved business records as an implicit reset. Local configs, credentials,
build artifacts and virtual environments are ignored by the component.
