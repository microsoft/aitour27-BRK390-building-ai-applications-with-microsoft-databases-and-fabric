# Deploy and run Act 3

Act 3 runs on real Azure services in a non-production demo environment:
Azure Functions, Azure SQL Database, Azure Cosmos DB, Azure OpenAI, and
Microsoft Entra ID.

This guide assumes those resources already exist. For the system design and
permission details, see the [Act 3 architecture](../docs/act3.md) and
[infrastructure reference](../infra/act3/README.md).

> **Recommended:** Run this setup with GitHub Copilot or your preferred coding
> agent using the [Act 3 agent runbook](act3-copilot.md). The complete manual
> steps remain below.

Run all commands from the repository root.

## What you need

### Local tools

- Node.js 24 or later
- npm
- Azure CLI
- Azure Functions Core Tools v4

### Azure and Fabric resources

| Resource | Requirement |
| --- | --- |
| Fabric SQL source | Deploy the synthetic Fabric estate using the [root instructions](README.md). Act 3 reads this source and does not modify it. |
| Azure Functions | Node.js 24, HTTPS, managed identity, and network access to Azure SQL and Cosmos DB. |
| Azure SQL Database | Microsoft Entra authentication and support for `VECTOR(1536)`. This is separate from the Fabric SQL source. |
| Azure OpenAI | An embedding deployment that produces 1,536-dimensional vectors. |
| Azure Cosmos DB for NoSQL | A container with partition key `/caseId`. |
| Microsoft Entra ID | An API registration, a browser SPA registration, and the Act 3 application roles. |

The Function managed identity needs:

- read and execute access to the Act 3 Azure SQL objects;
- read access to the Act 3 Cosmos container;
- Azure OpenAI inference access.

The API uses these application roles:

- `ROLE-ACT3-READER`
- `ROLE-ACT3-REVIEWER`
- `ROLE-OPERATIONS-APPROVER`
- `ROLE-HR-APPROVER`
- `ROLE-MAINTENANCE-APPROVER`

Register these SPA redirects:

```text
https://<function-app>.azurewebsites.net/api/app
https://<function-app>.azurewebsites.net/api/auth-redirect
```

## 1. Configure the environment

Create a local `.env`:

```sh
cp .env.example .env
```

Fill in the values for your Fabric source, Azure subscription, Function app,
Entra registrations, Azure SQL database, Azure OpenAI deployment, and Cosmos
container.

Use:

- `FABRIC_SQL_*` for the read-only Fabric source;
- `ACT3_SQL_*` for the standalone Azure SQL database used by the application;
- a new `ACT3_STAFFING_CASE_ID` for each demo setup or rehearsal.

Keep these disabled until you intentionally seed data:

```text
CALDOVA_ALLOW_CLOUD_WRITES=false
CALDOVA_SYNTHETIC_SOURCE_CONFIRMED=false
```

Do not commit `.env`.

## 2. Validate and build locally

```sh
npm ci
npm run demo:prepare
```

This command runs the tests, validates the generated staffing scenario, previews
the Cosmos memory and a rehearsal case without cloud access, checks the
configuration, and creates:

```text
build/act3-deploy/
```

## 3. Seed a new demo environment

Skip this section when the Azure SQL case, policies, and Cosmos memory already
exist.

Review the target resource names in `.env`, then temporarily set:

```text
CALDOVA_ALLOW_CLOUD_WRITES=true
CALDOVA_SYNTHETIC_SOURCE_CONFIRMED=true
```

Run:

```sh
npm run demo:seed
```

This applies the Act 3 SQL schemas, imports the synthetic Fabric source,
creates the Cosmos memory, and inserts the staffing case.

The seed is create-once. If the memory or case already exists, the command stops
instead of replacing it.

Set both write flags back to `false` after the seed completes.

## 4. Deploy the Function

Copy the required `ACT3_*` and `ENTRA_*` values into the Function application
settings using your normal Azure configuration process.

Build and publish:

```sh
npm run demo:package
pushd build/act3-deploy
func azure functionapp publish "$AZURE_FUNCTION_APP" \
  --subscription "$AZURE_SUBSCRIPTION_ID" \
  --javascript \
  --no-build
popd
```

Verify the deployed configuration and sign-in endpoints:

```sh
npm run demo:preflight
npm run demo:auth-check
```

## 5. Rehearse the demo

Open:

```text
https://<function-app>.azurewebsites.net/api/app
```

Then verify the complete flow:

1. Sign in with the presenter account.
2. Open the current staffing case.
3. Review the retained colleague lesson and current Azure SQL policies.
4. Generate the staffing proposal.
5. Record the operations approval.
6. Record the HR approval.
7. Publish the workforce plan.
8. Confirm that the plan and approval receipts remain visible after refresh.

## Prepare another rehearsal

Every rehearsal uses a new case ID. Preview it first:

```sh
node scripts/act3/prepare-staffing-session.mjs \
  --case-id SESSION-20260925-01
```

Create it in Azure SQL:

```sh
CALDOVA_ALLOW_CLOUD_WRITES=true \
node --env-file=.env scripts/act3/prepare-staffing-session.mjs \
  --case-id SESSION-20260925-01 \
  --write
```

Set the Function application setting `ACT3_STAFFING_CASE_ID` to the new ID,
restart the app if required, and run:

```sh
npm run demo:preflight
```

Do not reuse or reset a case that already contains approvals. If a write times
out, inspect that case ID before running the command again.

## Troubleshooting

| Problem | Check |
| --- | --- |
| `demo:prepare` reports missing settings | Compare `.env` with [.env.example](../.env.example). |
| Sign-in fails | Confirm the tenant, client ID, API scope, and both registered redirect URLs. |
| SQL or Cosmos is unreachable | Confirm the Function network path and managed-identity permissions. |
| No staffing option is eligible | Create a new rehearsal case; do not reset an existing case clock. |
| Preflight passes but the browser flow fails | Sign in as the actual presenter and inspect the current case, roles, policies, and Cosmos source. |

## Reference

- [Act 3 architecture](../docs/act3.md)
- [Act 3 source and tests](../src/act3/README.md)
- [Infrastructure and permissions](../infra/act3/README.md)
- [Security and validation record](../docs/act3-security-review.md)
- [AI coding-agent runbook](act3-copilot.md)
