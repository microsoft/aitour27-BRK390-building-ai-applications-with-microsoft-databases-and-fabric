# Caldova decisions — Act 2

Agent-led marketing decisions, factory planning in Teams, and retained decision
memory. This Python component complements [Caldova Insights](../caldova-insights/README.md)
and the [Fabric estate](../fabric/) through a **separate tested scenario variant**.
Read the [narrative boundary](../../docs/act2.md) before combining recordings:
the existing Fabric scenario uses different regions, numbers, and production rules.

## Demo sequence

These three demos all belong to Act 2; Demo 3 is not Act 3. See the
[session-order reference](../../docs/session-order.md). Act 3's later workforce
decision retrieves memory; Demo 4 here only retains it.

| Demo | Experience | Implementation |
| --- | --- | --- |
| 2: Decide | Tim asks a Cowork agent to compare campaign investments and approves an exact forecast | [Campaign tools and plugin](plugin/README.md), `app/`, SQL 50–60 |
| 3: Act | Karin asks the Teams agent to preserve maintenance and existing orders, then approves a revised schedule | [Factory Planning Agent](factory_agent/README.md), SQL 70 |
| 4: Remember | Inspect the saved decision, source turns, toolkit summary and extracted facts in Cosmos DB | [Decision memory](decision_memory/README.md), SQL 80 |

All business fixtures are fictional. All monetary amounts use USD. No tenant
exports, local credentials, trial purchases or live approval records are included.
The imported source was demonstrated against Azure services. The relocated,
parameterized component passes 12 local tests; three cloud integration tests are
opt-in and were not rerun during the import.

## Start here

Follow [Act 2 setup](../../instructions/act2.md). Run component commands from
this directory, not the repository root. Root `create-data.sh` deploys Fabric;
it does not deploy these standalone Azure services.

```sh
uv sync --locked --group dev
cp .env.example .env
# Edit .env. Set PGHOST, PGDATABASE=postgres, PGUSER and PGSSLMODE=require.
# Supply the PostgreSQL password through ~/.pgpass, mode 600.
uv run --env-file .env psql -X -w -f sql/05-extensions.sql
```

Register the model on a fresh database before running the walkthrough:

```sh
uv run --env-file .env python scripts/register-model.py \
  --subscription YOUR_SUBSCRIPTION_ID \
  --resource-group YOUR_FOUNDRY_RESOURCE_GROUP \
  --account YOUR_FOUNDRY_ACCOUNT
uv run --env-file .env python scripts/deploy-database.py
uv run --env-file .env python scripts/walkthrough.py \
  --case-id HYDRATION-SUNSCREEN-CAMPAIGN-001 --approve
```

The model helper defaults to deployment `gpt-5.4-mini` and registry alias
`caldova-chat`. Configure those names to match your account. It retrieves a model
key into process memory and binds it to SQL without logging it. Skip registration
if the alias already exists.

For an agent-led experience, start the MCP server and worker:

```sh
AUTH_MODE=local uv run --env-file .env python scripts/run-agent.py
```

Open `http://localhost:8000` with a job ID returned by the agent tools. This is
the supporting inspection view; Cowork remains the request-and-approval interface.
For remote use, configure Entra authentication and HTTPS as described in the
[plugin guide](plugin/README.md).

## Stage-critical values

- Revised six-week baseline: **316,667 units**, already including the weather signal.
- Extra budget: **USD 30,000**.
- Incremental campaign demand: **57,000 units**; total **373,667**.
- Uplift: **18.0%**, rounded to one decimal place.
- North America: USD 18,000 / 36,000 units; Europe: USD 12,000 / 21,000 units.
- Historical-response range: **50,400–63,600** extra units; not a confidence interval.
- Broad investment fails Latin America's zero channel-headroom constraint.
- Factory: MW-77 blocks PKG-03 on days 6–10. Preserve maintenance and orders by
  scheduling **34,200** on PKG-03 days 3–5 and **22,800** on PKG-01 days 6–10.
- Memory records approval and planned action; **actual production outcome remains pending**.

## AI and database responsibilities

`caldova_evidence_v3` runs CHUNK → EXTRACT on regional outlook and policy packets.
SQL calculates current/broad/targeted options using historical response, stock,
receipts, channel limits and approved policy. `caldova_recommendation_usd_v1` runs
CHUNK → EXTRACT reference → GENERATE → EXTRACT claims. Approval compares generated
claims to SQL results and checks that the reviewed inputs are unchanged.

Pipeline IDs are not business IDs. The installed preview exposed batch-local chunk
IDs, so joins validate explicit references and exact source text. SQL human approval
is separate from the documented AI Pipeline step builders.

## Infrastructure and preview notes

See [infra/README.md](infra/README.md). The source was tested with PostgreSQL 17.11,
`azure_ai` 2.2.2 and `pg_durable` 0.2.5. Durable execution on that HorizonDB preview
was bound to `postgres`; application tables are isolated in `caldova` and `factory`
schemas. Parameter groups were immutable, and Bicep type metadata was unavailable
for some preview resource types. Confirm current capabilities on your instance.

## Validation and repeat runs

```sh
uv run pytest -q
node --check app/static/app.js
```

Cloud integration tests are opt-in through `CALDOVA_LIVE_TEST` and
`CALDOVA_FACTORY_LIVE_TEST`. They create/approve demo records; inspect their scope
before running. Factory approval tests use a rolled-back transaction, while the
agent integration test saves a real demo approval. Use a disposable environment.

Use fresh business case IDs rather than deleting reviewed decisions. A factory
approval reserves capacity; repeating the same case returns its commitment.
Do not run the manual pipeline scripts concurrently with the agent worker.

SQL files 10–40 preserve the original summarization prototype for reference. They
are not the current request-driven deployment. Use `scripts/deploy-database.py`
and [demo/README.md](demo/README.md) for the current path.

## Source provenance

Imported from `aitour26-brk290-act2`, commits `65e2ffd`, `79763d4`, and `829b65f`.
The import preserves all implementation files and replaces machine/tenant setup
state with configuration templates. See the [integration plan](../../docs/act2-integration-plan.md).
