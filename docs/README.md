# Architecture and reference documentation

The Caldova demos combine operational, analytical, real-time, semantic, and
application surfaces in one governed Fabric scenario.

## Solution flow

1. The deterministic scenario in
   [`data/scenario.json`](../data/scenario.json) generates the fictional Caldova
   estate.
2. [`create-data.sh`](../create-data.sh) and
   [`create-data.ps1`](../create-data.ps1) validate and stage the payload.
3. Fabio creates or resolves the Fabric SQL Database, Lakehouse, Eventhouse/KQL
   database, ontology, Direct Lake semantic model, and data agent.
4. The data agent grounds answers in approved semantic-model measures, KQL
   signals, Lakehouse evidence, and the ontology peer surface.
5. [`Caldova Insights`](../src/caldova-insights/README.md) embeds the commercial
   dashboard in Fabric and calls the published data agent with the signed-in
   user's delegated identity.
6. Decision cases, actions, receipts, corrections, and outcomes create reusable
   business memory without changing model weights.

## Systems of authority

| Concern | Authoritative surface |
|---|---|
| Products, regions, campaigns, policies, plans, and governed actions | Fabric SQL Database |
| Sales, forecast, campaign, weather, inventory, and production time series | Eventhouse/KQL |
| Analytical projections, narrative evidence, evaluation assets, and files | Lakehouse/OneLake |
| Business entities and relationships | Fabric IQ ontology |
| Measures and governed analytical queries | Direct Lake semantic model |
| Cross-source natural-language analysis | Fabric data agent |
| User-facing dashboard and assistant | Caldova Insights |

The AI surfaces are read-oriented. Human approval and approved domain actions
remain explicit parts of the scenario.

## Reference map

- [Canonical session order, acts, and demo numbering](session-order.md)

The [Act 2 architecture](act2.md) documents an additional standalone Azure variant
and the expected values that differ from the Fabric dataset. Its marketing approval
and production actions are writable, unlike the read-oriented analytical surfaces
above. See the [integration plan](act2-integration-plan.md) for provenance and scope.

- [Act 3 workforce decision architecture](act3.md)
- [Dataset inventory and stage-critical values](../data/README.md)
- [Attendee deployment and demo guide](../instructions/README.md)
- [Fabric data-agent definition](../src/fabric/CaldovaLaunch.DataAgent/README.md)
- [Fabric ontology definition](../src/fabric/CaldovaLaunch.Ontology/README.md)
- [Direct Lake semantic model](../src/fabric/CaldovaLaunch.SemanticModel/README.md)
- [Caldova Insights application](../src/caldova-insights/README.md)
- [Infrastructure requirements](../infra/README.md)

All business data is synthetic and fictional. Do not add tenant exports,
credentials, customer data, or deployment state to this repository.
