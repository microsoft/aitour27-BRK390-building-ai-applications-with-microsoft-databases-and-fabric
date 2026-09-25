# Act 2 database walkthrough reference

Use the supporting query files from VS Code connected to HorizonDB database
`postgres`. All figures belong to the standalone Act 2 variant documented in
[docs/act2.md](../../../docs/act2.md), not the frozen root Fabric scenario.

## Query order

| File | Purpose |
| --- | --- |
| `00-ai-spotlight.sql` | Live AI Function call, deployed pipeline graphs, definitions and actual durable AI calls |
| `01-request.sql` | Create Tim's request; no allocation preselected |
| `02-business-evidence.sql` | Regional facts, historical response and approved policy |
| `03-ai-evidence.sql` | Extract outlook fields and inspect saved evidence |
| `04-compare-options.sql` | Calculate and compare current, broad and targeted investment |
| `05-ai-recommendation.sql` | Generate explanation, extract claims and inspect actual run |
| `06-approve.sql` | Approve the exact reviewed evaluation; inspect commitment and queued handoff |
| `07-cosmos-memory.sql` | Cosmos Data Explorer retention queries; run in the named Cosmos container, not PostgreSQL |

Run blocks separately. Use a fresh business case ID per request and replace the
approval placeholder with the exact evaluation reviewed. Never auto-select the
latest evaluation when approving. If multiple versions exist, filter queries to
the intended one.

## Interactive development runner

```sh
uv run --env-file .env python scripts/walkthrough.py \
  --case-id HYDRATION-SUNSCREEN-CAMPAIGN-001 --approve
uv run --env-file .env python scripts/walkthrough.py --ai-showcase-only
```

The runner pauses at the live function call, definition, deployed steps, graph,
execution and saved output. The showcase-only option makes one live extraction
call and reads existing runs; it does not create another campaign. `--auto` removes
pauses for unattended checks. `--approve` is opt-in and records a real demo approval.

## Expected business results

| Scenario | Extra budget (USD) | Incremental units | Eligibility |
| --- | ---: | ---: | --- |
| Current | 0 | 0 | Eligible |
| Broad | 30,000 | 41,625 | Ineligible: Latin America channel headroom is zero |
| Targeted | 30,000 | 57,000 | Recommended |

North America receives USD 18,000 and Europe USD 12,000. Total demand is 373,667;
uplift is 18.0% rounded; low/high historical-response scenarios are 50,400–63,600.
These are calculations, not model-provided probabilities. Supply covers the baseline;
the incremental 57,000 units require production confirmation. Factory scheduling
is evaluated separately by Karin's agent.

## Explain the two AI pipelines

First, AI makes the evidence usable. SQL evaluates options. Then AI explains the
recommendation. In `caldova_recommendation_usd_v1`, the final extraction reads
`generated_text`, so SQL can compare the model's actual numerical claims with its
authoritative results. Human review still matters.

`ai.explain()` displays the deployed graph. The PostgreSQL extension's graphical
Pipelines & Workflows pane is optional and version-dependent. In an agent-created
request, use `agent_run_links` to show the exact runs belonging to that job instead
of the latest global run. The manual runner does not create those job links.

## Approval and memory boundaries

The local walkthrough records the SQL role plus the fictional business owner Tim.
Cowork adds authenticated tenant/user attribution through agent reviews. A queued
factory request does not mean a Teams message was delivered. The Factory Planning
Agent is separately installed in the shared team and only Karin can approve its
production revision.

Demo 4 presents persisted decision memory. The toolkit's counters and leases are
infrastructure, not business knowledge. Actual production outcome is pending, and
new-session retrieval belongs to Act 3.

Presenter narration is integrated into the repository's existing single
[delivery guide](../../../delivery-resources/README.md). This page is an executable
component reference, not an alternate presenter guide.
