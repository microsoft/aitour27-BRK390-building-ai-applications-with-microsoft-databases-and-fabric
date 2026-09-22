# CaldovaLaunch Data Agent

`CaldovaAnalyst` is the Fabric data-agent definition for the Caldova launch analysis. It answers the commercial question "What's driving the increase in Hydration Sunscreen sales, and is it likely to continue?" with Caldova's governed model, ontology, KQL signals and Lakehouse evidence instead of generic climate or retail knowledge.

## Files

| File | Purpose |
| --- | --- |
| `agent.json` | Machine-readable agent definition consumed by deployment automation. |
| `instructions.md` | System instructions for grounding, named-measure usage, evidence-chain explanation and approval governance. |
| `fewshots/semantic-model.json` | Reference-only DAX examples using verified measures from `CaldovaLaunchModel`; SemanticModel sources do not accept uploaded few-shots. |
| `fewshots/ontology.json` | Natural-language prompts for `fabio ontology search`, using verified entity and relationship names. |
| `fewshots/kql.json` | KQL examples over raw eventhouse tables. |
| `fewshots/lakehouse.json` | T-SQL examples over Lakehouse Delta tables and evidence tables. |

## Grounding sources and selected elements

| Source key | Fabric item | Type | Consumption | Selected | Why this subset |
| --- | --- | --- | --- | ---: | --- |
| `semanticModel` | `CaldovaLaunchModel` | `SemanticModel` | Attached data-agent source; no few-shot upload support | 18 of 46 tables | Keeps governed named measures for opportunity, regional variance, signal persistence, weather uplift, capacity and outcomes without exposing unrelated operational dimensions. |
| `ontology` | `CaldovaBusinessMeaning` | `Ontology` | Peer surface via `fabio ontology search` / `fabio ontology mcp-url`; not attachable as a data-agent source | 19 of 26 entity types | Covers the approved Act 1 evidence chain and decision-memory chain while omitting distractor entities such as inventory, plants, weather stations, weather events and metric definitions. |
| `signalsKql` | `CaldovaSignals` | `KQLDatabase` | Attached data-agent source with uploadable few-shots | 6 of 11 tables | Exposes only raw time series used by the demos: forecast actuals, campaign signals, climate observations, weather forecasts/observations and line telemetry. |
| `analyticsLakehouse` | `CaldovaAnalytics` | `Lakehouse` | Attached data-agent source with uploadable few-shots | 20 of 66 tables | Focuses on the five new Act 1 evidence tables plus dashboard variance/reconciliation, campaign/capacity, governed action and decision-memory Delta tables. |

The Lakehouse evidence tables are essential because the data agent grounds best on tabular sources. They carry the advisory (`SIG-ENSO-2026-07`), decision-day briefing (`WX-BRIEF-20260803`), Meridian Climate Services attribution, and the five-hop evidence trace that used to exist only in JSONL documents.

The ontology grounding story is still intact, but it now enters through the ontology surface rather than `data-agent add-datasource`. Use `fabio ontology search` for natural-language traversal over bound ontology data, or `fabio ontology mcp-url` when an IDE or orchestrating agent needs the ontology endpoint.

## Deploy

From the repository root, deploy the underlying Caldova Fabric items first:

```bash
export WORKSPACE_ID=<workspace-id>
./create-data.sh --workspace "$WORKSPACE_ID" --dry-run
./create-data.sh --workspace "$WORKSPACE_ID"
```

Then create and configure the data agent. The deployment script may prefix the display name; the logical name in `agent.json` must remain `CaldovaAnalyst`.

```bash
AGENT_DIR=src/fabric/CaldovaLaunch.DataAgent
AGENT_NAME=$(python3 -c 'import json; print(json.load(open("src/fabric/CaldovaLaunch.DataAgent/agent.json"))["name"])')
AGENT_DESC=$(python3 -c 'import json; print(json.load(open("src/fabric/CaldovaLaunch.DataAgent/agent.json"))["description"])')

AGENT_ID=$(fabio data-agent create --workspace "$WORKSPACE_ID" --name "$AGENT_NAME" --description "$AGENT_DESC" --query id --output plain)

fabio data-agent add-datasource --workspace "$WORKSPACE_ID" --id "$AGENT_ID" --artifact CaldovaLaunchModel --artifact-type SemanticModel --instructions "$(python3 -c 'import json; j=json.load(open("src/fabric/CaldovaLaunch.DataAgent/agent.json")); print(j["dataSources"][0]["instructions"])')" --lro-timeout 300
fabio data-agent add-datasource --workspace "$WORKSPACE_ID" --id "$AGENT_ID" --artifact CaldovaSignals --artifact-type KQLDatabase --instructions "$(python3 -c 'import json; j=json.load(open("src/fabric/CaldovaLaunch.DataAgent/agent.json")); print(j["dataSources"][2]["instructions"])')" --lro-timeout 300
fabio data-agent add-datasource --workspace "$WORKSPACE_ID" --id "$AGENT_ID" --artifact CaldovaAnalytics --artifact-type Lakehouse --instructions "$(python3 -c 'import json; j=json.load(open("src/fabric/CaldovaLaunch.DataAgent/agent.json")); print(j["dataSources"][3]["instructions"])')" --lro-timeout 300

fabio data-agent select-tables --workspace "$WORKSPACE_ID" --id "$AGENT_ID" --datasource CaldovaLaunchModel --tables "$(python3 -c 'import json; j=json.load(open("src/fabric/CaldovaLaunch.DataAgent/agent.json")); print(",".join(j["dataSources"][0]["selectedElements"]))')"
fabio data-agent select-tables --workspace "$WORKSPACE_ID" --id "$AGENT_ID" --datasource CaldovaSignals --tables "$(python3 -c 'import json; j=json.load(open("src/fabric/CaldovaLaunch.DataAgent/agent.json")); print(",".join(j["dataSources"][2]["selectedElements"]))')"
fabio data-agent select-tables --workspace "$WORKSPACE_ID" --id "$AGENT_ID" --datasource CaldovaAnalytics --tables "$(python3 -c 'import json; j=json.load(open("src/fabric/CaldovaLaunch.DataAgent/agent.json")); print(",".join(j["dataSources"][3]["selectedElements"]))')"

fabio data-agent update-config --workspace "$WORKSPACE_ID" --id "$AGENT_ID" --instructions-file "$AGENT_DIR/instructions.md" --enable-preview-runtime
fabio data-agent upload-fewshots --workspace "$WORKSPACE_ID" --id "$AGENT_ID" --datasource CaldovaSignals --file "$AGENT_DIR/fewshots/kql.json"
fabio data-agent upload-fewshots --workspace "$WORKSPACE_ID" --id "$AGENT_ID" --datasource CaldovaAnalytics --file "$AGENT_DIR/fewshots/lakehouse.json"
fabio data-agent publish --workspace "$WORKSPACE_ID" --id "$AGENT_ID" --description "Caldova launch grounded configuration"
```

Do not upload `fewshots/semantic-model.json`: Fabric currently rejects SemanticModel few-shots, and `upload-fewshots` may appear to succeed while storing zero examples. Its DAX is retained as reference material, with the important measure guidance folded into `instructions.md`.

Do not add `CaldovaBusinessMeaning` with `data-agent add-datasource`: Fabric returns `OntologyAddAsDataSourceBlocked`. Use the ontology surface directly:

```bash
export ONTOLOGY_ID=<ontology-id>
fabio ontology mcp-url --workspace "$WORKSPACE_ID" --id "$ONTOLOGY_ID"
fabio ontology search --workspace "$WORKSPACE_ID" --id "$ONTOLOGY_ID" --prompt "Which regions are affected by the El Nino signal SIG-ENSO-2026-07?"
```

## Evaluate

Run the hero prompt and compare the answer to the expected facts in `data/evaluation/questions.json`.

```bash
fabio data-agent query --workspace "$WORKSPACE_ID" --id "$AGENT_ID" --prompt "What's driving the increase in Hydration Sunscreen sales, and is it likely to continue?"
fabio data-agent evaluate --workspace "$WORKSPACE_ID" --id "$AGENT_ID" --questions data/evaluation/questions.json
```

A good Act 1 answer must include `SIG-ENSO-2026-07`, the four affected regions versus two controls, 100,000 units / $800,000, `0.78` persistence probability, a clear statement that `SCN-2026-HS-B` is recommended and not yet approved, and the honest horizon: the 30-day forecast ends 2026-09-02 while the campaign runs to 2026-10-02.

## Limitations

- Ontologies can no longer be data-agent data sources. `agent.json` keeps the ontology entry with `attachAs: "PeerSurface"` so deployment automation can branch to `fabio ontology search` / `fabio ontology mcp-url`.
- SemanticModel data sources do not support stored few-shots. `fewshots/semantic-model.json` is reference-only; only KQL and Lakehouse few-shots should be uploaded.
- In the verified tenant, `fabio data-agent query` currently fails because the Fabric tenant setting `AllowStoreAOAIDataInOtherRegions` is disabled. The agent creates, configures and publishes correctly; this is an admin/environment gap, not a definition issue.
