# Delivery resources

Presenter, re-delivery, and train-the-trainer materials for this session.

## Core materials

| Item | Link | Notes |
|---|---|---|
| Delivery deck | [BRK390 delivery deck](https://aka.ms/brk390/slides) | Public session slides |
| Session recording |  | Optional URL when available |
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

Use the final deck as the timing authority once its public URL is supplied. The
technical demo order is:

1. **Commercial signal:** show the Hydration Sunscreen demand variance, affected
   regions, weather evidence, and persistence horizon.
2. **Recommendation to commitment:** compare scenarios and emphasize that the
   recommended plan still requires human approval.
3. **Production conflict:** show the `PKG-02` maintenance constraint, the
   57,920-unit shortfall, and the policy-compliant operating option.
4. **Decision memory:** show how evidence, actions, receipts, corrections, and
   outcomes can be retrieved for a later decision.

The default data intentionally stops before the hero decision is approved. Do
not switch to the outcome slice until the narrative calls for the reveal.

## Demo reproducibility

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
