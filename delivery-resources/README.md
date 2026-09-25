# Delivery resources

Presenter, re-delivery, and train-the-trainer materials for this session.

## Core materials

| Item | Link | Notes |
|---|---|---|
| Delivery deck | [English](https://aka.ms/aitour27/BRK390/slides/en) | Required URL |
| Attendee landing page | [Session README](../README.md) | Public starting point |
| Post-event attendee guidance | [Instructions](../instructions/README.md) | To be added later |
| Deployment and demo guide | [Attendee instructions](../instructions/README.md) | Public Fabric setup, verification, app deployment, and cleanup |
| Dataset reference | [Data guide](../data/README.md) | Scenario state, inventory, and expected demo values |
| Application guide | [Caldova Insights](../src/caldova-insights/README.md) | App configuration, build, deployment, and troubleshooting |

## Delivery checklist

- Confirm that the public deck URL is available.
- Review the session README and attendee instructions.
- Use a dedicated disposable Fabric workspace.
- Verify Node.js 24 or later and Fabio 0.71.0 or later.
- Confirm the presenter can create and query the required Fabric item types.
- Run the root deployment script with `--dry-run`.
- Deploy and run `--verify-only` before the session.
- Confirm the default dataset is the undecided `2026-08-03` slice.
- Open the Fabric items and Caldova Insights app in presenter order.
- Keep the expected values in `data/evaluation/expected-results.json` available
  for recovery and narration.

## Session preparation

1. Start from a clean checkout and confirm no tenant-specific configuration or
   generated state will be committed.
2. Follow the [attendee deployment guide](../instructions/README.md) through
   verification.
3. Configure and deploy Caldova Insights in the same workspace as the data
   agent.
4. Confirm the app's `DATA_AGENT_MCP_URL` secret points to that workspace's
   published data agent.
5. Test the four demo questions and record which portal tabs will be used.
6. Keep the workspace and browser session stable between preflight and delivery.

## Run of show

Use the [delivery deck](https://aka.ms/brk390/slides) as the timing authority and
the [session-order reference](../docs/session-order.md) for act/demo terminology.

1. **Act 1 / Demo 1 — See and understand:** show Hydration Sunscreen demand variance,
   affected regions, weather evidence and persistence through Caldova Insights.
2. **Act 2 / Demo 2 — Decide:** Tim asks Cowork to compare campaign scenarios, reviews
   evidence and approves an exact marketing forecast in HorizonDB.
3. **Act 2 / Demo 3 — Act:** Karin investigates the production dependency in Teams,
   preserves maintenance and existing orders, and approves a calculated revision.
4. **Act 2 / Demo 4 — Remember:** show the decision case and toolkit-derived memory
   in Cosmos DB. End at retention with actual production outcome pending.
5. **Act 3 — Improve:** retrieve prior experience for the next workforce decision
   and check it against current Azure SQL policy and capacity. Follow the
   [Act 3 presenter instructions](../instructions/act3.md).

The Fabric default data stops before hero approval. Its optional outcome and
retrieval slices are dataset examples, not evidence of the standalone Act 2
decision's actual production outcome. Do not reveal recall in Demo 4.

## Demo reproducibility

### Standalone Act 2 recording variant

For Demos 2–4, the imported
[Act 2 variant](../docs/act2.md) uses **USD 30,000 / 57,000 extra units**, **PKG-03**,
and **MW-77 days 6–10**. Its production response preserves maintenance rather than
deferring it. The original Fabric walkthrough instead uses `PKG-02` and a
57,920-unit shortfall. Do not describe the imported figures as the same case as the Fabric
100,000-unit campaign and 57,920-unit shortfall.

Prepare the variant using [Act 2 setup](../instructions/act2.md). Its recording order:

1. **Demo 2 — Decide:** Tim asks Cowork for campaign guidance. Show the HorizonDB
   evidence extraction, SQL scenario comparison and recommendation pipeline. Tim
   approves the exact forecast; the system queues a production review for Karin.
2. **Demo 3 — Act:** In a shared Teams thread, Karin asks the Factory Planning Agent
   to preserve maintenance and existing orders. It proposes 22,800 units on PKG-01
   days 6–10 and 34,200 on PKG-03 days 3–5. Karin approves the returned proposal ID.
3. **Demo 4 — Remember:** Open the Cosmos case, source turns, toolkit summary and
   facts. End with the distinction between approved plan and pending actual outcome.
   Do not show recall in a new Teams conversation: that belongs to Act 3.

Suggested narration connecting the technical views:

> First, AI makes the evidence usable. SQL evaluates the options. Then AI explains
> the recommendation. Tim approves the commercial commitment, and Karin confirms
> a production response. Cosmos DB retains the decision and its context so the
> organization owns what it learned.

For the Cosmos shots:

> The case record tells us what the business approved. The Agent Memory Toolkit
> condenses the interaction into a summary and individual facts. These remain linked
> to the decision and its source material. Actual production is still pending.

Use the component [query walkthrough](../src/caldova-decisions/demo/README.md),
[factory guide](../src/caldova-decisions/factory_agent/README.md), and
[memory guide](../src/caldova-decisions/decision_memory/README.md). Run model checks
before recording and keep the same case/evaluation IDs throughout. Shorten waits
with a visible cut rather than implying instant model execution. Use fresh
unapproved cases for rehearsal; approvals reserve capacity and must not be erased
as an implicit reset. Local workers, HTTPS tunnels and signed-in browser sessions
must remain running during delivery.

### Fabric reproducibility commands

From the repository root:

```bash
./create-data.sh --workspace <workspace-id> --dry-run
./create-data.sh --workspace <workspace-id>
./create-data.sh --workspace <workspace-id> --verify-only --evaluate-agent
```

The PowerShell entry point accepts the same `--workspace`, `--verify-only`, and
`--evaluate-agent` flags.

Use the component READMEs for deeper recovery:

- [Data agent](../src/fabric/CaldovaLaunch.DataAgent/README.md)
- [Ontology](../src/fabric/CaldovaLaunch.Ontology/README.md)
- [Semantic model](../src/fabric/CaldovaLaunch.SemanticModel/README.md)
- [Caldova Insights](../src/caldova-insights/README.md)
- [Act 3 workforce decision](../src/act3/README.md)

## Setup notes

- Keep the workspace disposable and avoid `--overwrite` unless resetting known
  demo resources.
- Do not use internal or pre-production Fabric endpoint overrides in public
  delivery instructions.
- Treat agent answers as non-deterministic. Verify the cited evidence and use
  the checked-in expected results as the recovery source.
- The app requires the Fabric portal embed for authentication. Use
  `npm run preview:layout` only as a visual fallback with fixture data.
- If a preview Fabric capability is unavailable in the tenant, use the
  pre-verified screenshots or recording associated with the final deck.

## Reset and fallback

- Re-run `--verify-only` before restarting a demo.
- Use a fresh workspace for a clean full reset.
- If the data agent cannot query because of tenant settings, show the deployed
  semantic model, KQL/Lakehouse evidence, and expected-result record while
  explaining the same evidence chain.
- If the embedded app is unavailable, run its fixture-backed layout preview or
  use the recording once provided.
- Do not regenerate with `--with-outcome` unless the delivery has reached the
  outcome reveal.

## Support

Content owners:

- [Paul DeCarlo (@toolboc)](https://github.com/toolboc)
- [Yohan Lasorsa (@sinedied)](https://github.com/sinedied)
- [Ismael Mejia Useche (@iemejia)](https://github.com/iemejia)
- [Alvaro Videla Godoy (@videlalvaro)](https://github.com/videlalvaro)
