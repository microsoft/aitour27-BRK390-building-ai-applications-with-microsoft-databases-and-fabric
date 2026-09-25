# Act 3 guidance retrieval

Status: local implementation, not deployed. The new endpoint is read-only and is not connected to the existing dashboard. It does not execute a production plan or publish guidance.

## Endpoint

`POST /api/act3/guidance` accepts JSON with `caseId` and `question`. The Function validates an Entra bearer token using the existing verifier and requires `ROLE-ACT3-READER`. This role grants reads across the dedicated demo database; it is not a per-case ACL. Do not expand the corpus to multiple organizations without adding the appropriate data authorization.

The SQL case supplies the line scope; a caller cannot select another scope through the request body. The model returns a query embedding. SQL performs exact cosine search over approved, effective guidance joined to its current approved policy version. Responses include source case/version/hash and distance. Empty results remain empty; distance is not a success probability.

The Functions registration uses `authLevel: anonymous` because the handler validates OAuth bearer tokens rather than Function keys. This does not make the handler's data route anonymous. Deployment should additionally configure single-tenant platform authentication, a request-size limit and rate limiting. The handler rejects bodies over 8 KiB after reading them; enforce an ingress limit as well.

## Required configuration

- `ENTRA_TENANT_ID`, `ENTRA_API_AUDIENCE`: expected tenant and API audience.
- `ACT3_SQL_SERVER`: dedicated standalone Azure SQL server hostname ending in `.database.windows.net`.
- `ACT3_SQL_DATABASE`: approved scenario database.
- `ACT3_EMBEDDING_ENDPOINT`: approved Azure OpenAI HTTPS endpoint ending in `.openai.azure.com`.
- `ACT3_EMBEDDING_DEPLOYMENT`: authorized embedding deployment.
- `ACT3_EMBEDDING_PROFILE`: immutable corpus/model/version identity.
- `ACT3_GUIDANCE_MAX_DISTANCE`: corpus-calibrated cosine cutoff; no arbitrary production default.

Use the Function's system-assigned managed identity for SQL and model access. The initial design uses 1,536-dimensional embeddings, compatible with a pinned ada-002 deployment. Do not mix embeddings from different models even when they have the same dimensions. Deployment/model upgrades require re-embedding the corpus under a new profile and recalibrating retrieval.

`functions.mjs` is the package entry point and imports native TypeScript under Node 24, matching the repository runtime. Functions-host loading still needs verification before deployment. The existing `npm start` remains the earlier local dashboard server; it does not start the Functions host.

## Data prerequisites

`sql/001_guidance.sql` is an unapplied schema migration. It creates an isolated `act3.guidance` table without seeding approvals or invoking a model. It depends at query time on the versioned `dbo.decision_cases` and `dbo.approved_policies` scenario tables. Its approval constraint is a structural check, not authorization: the deployment must restrict publication to a separate reviewed writer path. That writer path is not implemented.

The current tenant uses 2026 scenario identifiers, while the local frozen scenario uses 2027 identifiers. Select and version the source export before seeding a dedicated database. Preserve the existing scenario contract.

## Verification and limits

`npm test` includes policy-boundary tests, adapter parameter binding, malformed-vector rejection, Function authorization and safe error responses. The full local suite passed 35 tests in this session.

A read-only check ran the query shape on SQL in Fabric using table-variable test rows, explicit numeric vectors and its actual approved policy. It excluded drafts, expired guidance, wrong-line guidance and stale policy versions. This was not a real embedding search.

Still required: approved real-embedding corpus, calibration/no-match evaluation, standalone Azure SQL and Functions-host execution, publication provenance validation, browser integration and identity tests. The maintenance evaluator is an application-side applicability check only. Execution must independently revalidate every production/material/maintenance constraint and bind approvals to the reviewed plan and policy versions in a SQL transaction. The earlier dashboard runtime does not yet meet that full contract.