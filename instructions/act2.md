# Deploy and run the Act 2 variant

Read the [scenario distinction](../docs/act2.md) first. This guide does not replace
the [Fabric setup](README.md), and root `create-data.sh` does not deploy Act 2.
Use disposable Azure resources and synthetic inputs. Run all commands below from
`src/caldova-decisions` after cloning this repository.

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
  --case-id HYDRATION-SUNSCREEN-CAMPAIGN-001 --karin-id YOUR_KARIN_OBJECT_ID
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
uv run --env-file .env python scripts/verify-decision-memory.py --proposal-id N --quiet
```

Replace N with Karin's approved production proposal. For future approvals, install
SQL 80 before the approval and keep the `--watch` worker running. Backfill of an
already approved proposal is supported. No actual delivery outcome is fabricated.

Use [Cosmos queries](../src/caldova-decisions/demo/07-cosmos-memory.sql) in Data
Explorer, adjusting the example proposal number in document/thread/user IDs. Show
the case, source interaction, generated summary/facts, then outcome pending.
Do not show a new retrieval conversation in Demo 4.

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
