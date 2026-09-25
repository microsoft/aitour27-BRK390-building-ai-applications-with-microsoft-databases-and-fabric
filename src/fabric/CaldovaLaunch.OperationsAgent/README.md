# Caldova Production Guardian

This directory owns the Act 3 Operations Agent contract. It monitors the precomputed campaign-capacity decision stream in Eventhouse and sends the recommendation to Teams. It has no configured executable actions. Approvals and writes belong to the separately authenticated Caldova Production Guardian application.

## Evidence states

| Path | What it proves | Allowed label |
| --- | --- | --- |
| `Configurations.json` plus local tests | Recommendation-only monitoring contract | Runnable repository path |
| Local `server.ts` call | Local action execution using scenario fixtures | Locally observed reference run |
| Fabric item configured in a tenant | Configuration exists | Deployed, not executed |
| `dbo.runtime_action_executions` row returned after approval | The governed tenant action ran | Observed tenant execution |

The generated rows in `dbo.governed_actions` and `dbo.action_receipts` are fixtures. They do not prove an API call. Script `008_governed_action_runtime.sql` creates the separate runtime journal used as retained execution evidence.

## Local reference path

Node.js 24 or later is required.

```bash
nvm use 24
node --test src/act3/*.test.ts
node src/act3/server.ts
```

Open `http://127.0.0.1:3903/` for the Production Guardian dashboard. It shows the capacity conflict, all four options, policy state, and the two approval boundaries without enabling writes.

The underlying snapshot endpoint is also available without write authority:

```bash
curl http://127.0.0.1:3903/v1/act3/snapshot
```

Action endpoints require a Microsoft Entra bearer token issued for the configured API audience. The application validates its signature, issuer, audience, expiry, object ID, and application roles. Approval time is assigned by the server rather than accepted from the request.

## Fabric and Power Automate path

1. Deploy the dataset so numbered SQL script `008_governed_action_runtime.sql` is applied after the schema, views, weather, decision-memory, and bridge scripts.
2. Create a Microsoft Entra database principal for the managed connection and add only that principal to `caldova_action_executor`.
3. Publish the SQL-derived recommendation into the flat Eventhouse `ProductionDecisionSignals` table.
4. Deploy `Configurations.json` as the Operations Agent definition and bind its variable reference to the KQL database. The agent sends recommendations to Teams and executes no action.
5. Register two application roles on the Caldova API: `ROLE-OPERATIONS-APPROVER` and `ROLE-MAINTENANCE-APPROVER`. Assign them to different accountable users or groups.
6. Each approver signs in to Production Guardian and approves only the action authorized by their token role.
7. The API calls `dbo.execute_governed_action` with the verified Entra object ID, the required role, a server-issued approval timestamp, and stable action and correlation IDs.
8. Display the procedure result in Production Guardian. A row in `dbo.runtime_action_executions` is the retained evidence that separates an observed call from a fixture receipt.

The production-plan and maintenance-deferral calls must remain separate. Each has a different role and policy version, and one approval cannot authorize the other action.

## Current deployment boundary

Microsoft publishes an Operations Agent item-definition schema with a single `Configurations.json` part. This repository follows that schema, but its KQL database variable and Teams destination must be bound in the demo tenant. Do not claim a deployed or observed Operations Agent until the tenant item, notification, authenticated approvals, and runtime-journal rows are retained.