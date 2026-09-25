# Session order and demo numbering

Acts describe the narrative stages; demo numbers identify demonstrations across
the session. **Demo 3 is part of Act 2, not Act 3.**

| Act | Demo / slide reference | Business question | Experience and technology |
| --- | --- | --- | --- |
| Act 1 — See and understand | Demo 1: commercial signal | Why is Hydration Sunscreen selling above forecast, and will it continue? | Caldova Insights, Microsoft Fabric and Fabric IQ |
| Act 2 — Decide, act, and remember | Demo 2: marketing decision (slide 20) | Where should Tim invest, and what demand will that create? | Copilot Cowork, HorizonDB AI Functions and AI Pipelines; explicit marketing approval |
| Act 2 — Decide, act, and remember | Demo 3: production response (slide 24) | Can Karin cover that demand while preserving maintenance and existing orders? | Teams Factory Planning Agent; calculated schedule and Karin's approval |
| Act 2 — Decide, act, and remember | Demo 4: decision memory (slide 26 and following memory slides) | What knowledge does Caldova retain after the conversation? | Azure Cosmos DB and Agent Memory Toolkit; case, turns, summary and facts |
| Act 3 — Improve | Later workforce-planning demonstration | How can Karin use earlier experience with current policy and capacity to meet the next commitment? | Retained memory and Azure SQL; this implementation is not included in the imported Act 2 component |

Slide references identify the working deck used to author these demos; confirm
them against the delivery deck if slides are reordered.

## Boundaries to preserve

- Demo 2 ends with an approved marketing plan and a production dependency.
- Demo 3 discovers the maintenance conflict, evaluates alternatives, and records
  production approval. Do not reveal its solution in Demo 2.
- Demo 4 shows retention only. Do not open a new Teams conversation to demonstrate
  recall; save retrieval and reuse for Act 3.
- An approved schedule is not a delivered outcome. Demo 4 leaves actual production
  and delivery pending.
- The factory split decision does not establish an earlier extra-packer staffing
  lesson. If Act 3 relies on that lesson, supply a separately sourced historical
  case rather than attributing it to Demo 3.

## Two executable scenario variants

The [Fabric dataset](../data/README.md) includes four walkthroughs and evaluation
questions, including production and retrieval examples. Those dataset walkthrough
numbers are not additional session acts. Historical references to “Act 3” for a
capacity projection or ontology traversal identify the legacy third walkthrough,
not the later workforce act.

The [standalone Act 2 variant](act2.md) implements the recorded marketing, Teams,
and toolkit-memory sequence. Its USD 30,000 / 57,000-unit figures differ from the
Fabric contract's USD 180,000 / 100,000-unit campaign. Keep each variant's evidence,
answers and production rules together. A conceptual transition from Act 1 does
not imply a live data transfer or numerical reconciliation between the variants.

Use the [delivery guide](../delivery-resources/README.md) for the run of show and
[Act 2 instructions](../instructions/act2.md) for deployment. Numbered SQL files
and setup steps are execution steps, not session demo numbers.
