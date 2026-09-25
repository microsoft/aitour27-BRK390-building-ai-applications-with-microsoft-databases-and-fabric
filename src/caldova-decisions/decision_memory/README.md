# Decision memory — Demo 4

Retain the completed marketing/production decision in **Azure Cosmos DB for NoSQL**
using **Agent Memory Toolkit 0.3.0b2**. This segment ends at **Remember**. Retrieval
in a new session belongs to Act 3 and is not part of this walkthrough.

## Containers

| Container | Contents and purpose |
| --- | --- |
| `case_records` | Application-assembled authoritative decision case, approval, action receipt, outcome status and memory links |
| `memories_turns` | Toolkit-stored user/agent messages and labeled business-record context |
| `memories_summaries` | Toolkit-generated thread summary, key decisions and open issues |
| `memories` | Individually extracted facts with embeddings and corpus-level provenance |
| `memory_counter` | Toolkit cadence bookkeeping |
| `memory_leases` | Reserved for change-feed coordination; may be empty in this in-process deployment |

Show the four business containers, not counters/leases. Use the actual approved
proposal ID from your Teams run. A case document ID is
`HYDRATION-SUNSCREEN-CAMPAIGN-001:production-N`, toolkit `user_id` is `caldova-case-N`,
and `thread_id` matches the case document ID. Counts and generated text vary by run.

## Capture flow

1. SQL 80 installs a trigger that queues an event in the **same transaction** as
   production approval. The transaction does not make model or Cosmos calls.
2. A worker freezes the approved plan and source conversation in `memory_outbox`.
3. Integration code assembles the business case and writes `case_records`.
4. The toolkit stores turns with `upsert_memory()`, then runs
   `generate_thread_summary()` and `extract_memories()`.
5. The integration verifies output/source associations, attaches corpus provenance,
   links the generated memory IDs to the case, and records completion.

This is explicit **in-process toolkit processing**, coordinated by a PostgreSQL
outbox worker. It is not an Azure Durable Functions/change-feed deployment. Case
scope avoids deriving a universal personal profile of Karin. No user-summary
operation is invoked.

The bot stores only messages addressed to it. Tim's unmentioned channel post is
not represented as a captured Teams turn; the authoritative marketing record is
included as explicitly labeled business context. Approval establishes the planned
action; actual manufacture/delivery remains **pending** until results are recorded.

## Configure Cosmos and model access

Use an existing Azure Cosmos DB account/database with Entra data access for the
operator. Required containers:

- `case_records`, partition `/caseId`.
- `memories`, `memories_turns`, `memories_summaries`, hierarchical partition keys
  `/user_id`, `/thread_id` (MultiHash v2).
- Counter/lease containers from `infra/memory-support.bicep`.

The current templates add support containers to an existing database, not a whole
Cosmos account. See [setup](../../../instructions/act2.md) for provisioning steps.

Set `COSMOS_ENDPOINT`, `COSMOS_DATABASE`, and `MEMORY_MODEL_ENDPOINT` in your local
environment. Default model deployment names are `gpt-5.4-mini` and
`text-embedding-ada-002`; override with `MEMORY_CHAT_DEPLOYMENT` and
`MEMORY_EMBEDDING_DEPLOYMENT`. The source verified 1536-dimensional embeddings.
The verification script assumes that dimension; adapt it when changing models.

```sh
psql -X -w -f sql/80-decision-memory.sql
uv run --env-file .env python scripts/capture-decision-memory.py --proposal-id N
uv run --env-file .env python scripts/verify-decision-memory.py --proposal-id N --quiet
uv run --env-file .env python scripts/capture-decision-memory.py --watch
```

Supply the exact approved ID for N. Backfill does not require another approval.
The watcher retries pending/failed captures up to five attempts. It must remain
running for future events; Azure CLI authentication is intended for local demos.
For a hosted worker, replace it with an appropriate managed identity.

## Preview findings preserved from the source

- `prompty==2.0.0a9` is pinned because 2.0.2 could not load the toolkit prompt files.
- Turn roles use `agent`, not `assistant`.
- ada-002 does not accept a dimensions parameter; inject a toolkit embeddings client
  without an override.
- The toolkit constructor attempts container provisioning. With Entra data-plane
  authentication, create all containers through management-plane tooling first.
- The tested containers lacked vector indexes. Embeddings were persisted, but
  indexed semantic/hybrid retrieval was not demonstrated. Configure it for Act 3.
- Per-fact source IDs were empty in the tested SDK. Integration adds **corpus-level**
  provenance and does not claim sentence-level attribution.
- One summary swapped line totals. The original was retained as a rejected review
  artifact; an authoritative correction turn caused a toolkit summary update.
  The known-transposition check is narrow, not general model validation. Read prose
  before presenting it; the case record is authoritative.

## Data Explorer sequence

Open your account → Data Explorer → configured database. Use
[demo/07-cosmos-memory.sql](../demo/07-cosmos-memory.sql), replacing the example
proposal number consistently. The sequence is case → source turns → summary →
facts → approved plan versus pending actual outcome. Do not introduce a new chat
or recall query in this segment.

The source backfill produced 11 source/context turns, one summary and seven facts
after a labeled quality correction; these are historical verification counts,
not seeded results or guarantees for a new environment.
