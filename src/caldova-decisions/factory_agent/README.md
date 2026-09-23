# Factory Planning Agent — Demo 3

A dedicated Teams bot for Tim and Karin using the Microsoft Teams SDK for Python.
Users @mention it in a shared channel thread, group chat, or personal chat. Karin
is the primary user and the only assigned production approver.

## Grounded behavior

`azure_ai.extract()` with registry alias `caldova-chat` interprets natural-language
intent and constraints. Python calculates capacity from daily schedules, existing
orders and maintenance. Replies are formatted from calculated facts. The model
cannot invent capacity or grant approval.

The case links to an exact approved marketing plan, selected with `--case-id`.
There is no “latest campaign” guess. The default business identifier is
`HYDRATION-SUNSCREEN-CAMPAIGN-001`.

## Scheduling fixture

- The six-week campaign needs its launch buffer packaged by planning day 10.
- Bulk product and packaging materials are ready from day 3; both lines are qualified.
- Original packaging is planned on PKG-03 days 6–10, when MW-77 blocks that line.
- PKG-03 days 3–5 has 20,000 gross units/day minus 8,600 committed: **34,200** free units.
- PKG-01 days 6–10 has 12,000 gross units/day minus 7,440 committed: **22,800** free units.
- Total **57,000**; alternate-line share **40%**. Existing orders and maintenance stay protected.

These are fictional fixtures for the Act 2 variant, not the root Fabric dataset's
PKG-02 maintenance-deferral scenario. See [the boundary](../../../docs/act2.md).

| Constraint | Calculated outcome |
| --- | --- |
| Original PKG-03 schedule | 57,000 units at risk |
| Allow three days earlier and alternate line | Feasible 34,200 / 22,800 split |
| No PKG-01 | 22,800 units uncovered |
| No earlier production | 34,200 units uncovered |
| Only two days earlier | 11,400 units uncovered |

## Deploy

Run from the component root with PG* variables configured:

```sh
psql -X -w -f sql/70-factory-planning.sql
uv run --env-file .env python scripts/seed-factory.py \
  --case-id HYDRATION-SUNSCREEN-CAMPAIGN-001 --karin-id YOUR_KARIN_OBJECT_ID
devtunnel user login
devtunnel create caldova-factory --allow-anonymous
devtunnel port create caldova-factory -p 3978 --protocol http
devtunnel host caldova-factory
```

Use the actual public hostname emitted by Dev Tunnels:

```sh
uv run python scripts/setup-factory-bot.py \
  --resource-group YOUR_AZURE_RESOURCE_GROUP \
  --endpoint https://YOUR_TUNNEL_HOST/api/messages \
  --tim-id YOUR_TIM_OBJECT_ID --karin-id YOUR_KARIN_OBJECT_ID
uv run --env-file .env python scripts/run-factory.py
uv run python scripts/package-factory.py \
  --bot-id YOUR_BOT_CLIENT_ID --base-url https://YOUR_TUNNEL_HOST
```

Setup creates/reuses a single-tenant Entra registration **and its service principal**,
then validates and deploys `infra/factory-bot.bicep`. The SDK validates Bot Service
JWTs. The app also checks tenant and configured user IDs. The relay allows transport
through, but the bot does not accept anonymous activities.

Development credentials are stored in ignored `.azure/local/factory-bot.json`, mode
0600. Tim and Karin object IDs must belong to the intended tenant. No default real
user identities are included in the project.

## Install in Teams

Teams → Apps → Manage your apps → Upload an app → Upload a custom app. Select
`dist/factory-planning-agent.zip` and **Add to a team**, choosing the channel shared
by Tim and Karin. A personal installation for Tim does not install it for the team.

If upload is blocked, an administrator must enable organization-wide custom app
use and assign an app setup policy with Upload custom apps enabled to the demo
users. Team member settings also affect team installation. Scope changes to the
intended demo users; these scripts do not modify tenant policies.

## Conversation and approval

Tim posts the approved marketing demand. Karin @mentions the agent:

> Can PKG-03 cover the approved campaign demand while protecting existing customer orders?

Then:

> Keep MW-77 in place and protect existing orders. What alternatives do we have?

After reviewing the returned proposal:

> Approve production proposal N

Replace N with the actual proposal ID. Continue in the same thread. The exact
approval command prevents ambiguous questions from becoming approvals. The backend
checks Karin's validated Teams object ID, recalculates capacity, rejects stale
snapshots and saves each allocation once. Threads and inbound activities are
persisted for context and idempotency.

The source implementation was tested through actual Tim/Karin Teams sessions;
the relocated contribution has not yet been deployed. A bot reply failure caused
by a missing service principal was corrected in the setup script.

## Checks and reset

`uv run pytest -q tests/test_factory.py` runs deterministic scheduling checks.
For opt-in live tests, set `CALDOVA_FACTORY_LIVE_TEST=1`, `ENTRA_TENANT_ID`,
`FACTORY_TIM_ID`, `FACTORY_KARIN_ID` and PG* variables. The approval test rolls back;
the natural-language test records turns/proposals. Run against a disposable fixture.

An actual approved case reserves its capacity. A fresh recording needs a new case
and capacity fixture; don't delete approval history or expect the same capacity
to be available for multiple campaigns.

References:
- https://microsoft.github.io/teams-sdk/python/getting-started/running-in-teams/
- https://microsoft.github.io/teams-sdk/teams/azure-configuration
