# Act 2: decide, act, and remember

This additive contribution introduces [Caldova decisions](../src/caldova-decisions/README.md):
an agent-led campaign workflow in Azure HorizonDB, a Teams Factory Planning Agent,
and decision capture through Agent Memory Toolkit into Azure Cosmos DB for NoSQL.

## Choose the scenario before delivery

The [existing Fabric scenario](../data/scenario.json) remains the frozen contract
for the root data generators and Act 1 experience. The imported implementation is
a **separate tested variant**, not a continuation of its numeric forecast.

| | Fabric contract | Standalone Act 2 variant |
| --- | --- | --- |
| Campaign | USD 180,000 / 100,000 extra units | USD 30,000 / 57,000 extra units |
| Regions | Six named regional markets | Four geographic regions |
| Production | PKG-02; 57,920-unit shortfall | PKG-03; MW-77 days 6–10 |
| Response | Reduced-rate/high-utilisation maintenance deferral | Preserve maintenance, split 40% to PKG-01, bring PKG-03 work forward |
| Outcome | Optional generated reveal slice | Approved schedule; actual delivery pending |

The transition between acts is conceptual: analytical evidence supports a new
commercial decision. Explicitly identify the scenario variant when switching
datasets. Do not claim an implemented live Fabric-to-HorizonDB sync: the current
HorizonDB outlook/history/inventory inputs are seeded fixtures.

## Narrative and systems of authority

| Step | Experience | Authority |
| --- | --- | --- |
| See / understand | Existing Fabric estate and Caldova Insights | Existing Fabric semantic/data contract |
| Decide | Tim asks Cowork; MCP tools queue evaluation; AI extracts/explains and SQL calculates | HorizonDB marketing records, policies and evaluated versions |
| Act | Karin @mentions the Teams bot, compares schedules and approves | HorizonDB factory schedule, capacity and production allocations |
| Remember | Capture approval, source interaction, toolkit summary and facts | Cosmos decision case linked to PostgreSQL approval; toolkit outputs are derived |
| Improve | Future decision using retained knowledge | Act 3; not implemented by the memory recording walkthrough |

The Teams agent is a separate bot from the Cowork plugin. The marketing tool queues
a production request; it does not send the Teams message. The supporting web app
is a read-only evidence/pipeline view rather than Tim's primary planning interface.

## Retaining the intelligence

Production approval writes an outbox event in the same PostgreSQL transaction.
A local worker captures the approved decision and bot-addressed interaction.
Agent Memory Toolkit writes turns and derives a summary and facts in Cosmos.
The business case preserves exact approvals and allocations independently of model
prose. A known summary transposition is recorded and corrected transparently.

This uses in-process toolkit operations, not a deployed Cosmos change-feed function.
No cross-thread profile of Karin is inferred. Embeddings are persisted; indexed
retrieval must be configured and verified separately for Act 3. The existing
Fabric-native Cosmos option is a different deployment surface from this Azure account.

## Navigation

- [Detailed integration plan and remaining owner decisions](act2-integration-plan.md)
- [Deployment instructions](../instructions/act2.md)
- [Component source](../src/caldova-decisions/README.md)
- [Cowork integration](../src/caldova-decisions/plugin/README.md)
- [Teams factory planning](../src/caldova-decisions/factory_agent/README.md)
- [Cosmos decision memory](../src/caldova-decisions/decision_memory/README.md)
- [Infrastructure index](../infra/act2/README.md)

After the initial additive import, the owner approved navigation updates and local
validation. The landing pages now link this variant and the existing single
presenter README includes its recording sequence. The frozen Fabric data contract
and Act 1 implementation remain unchanged.
