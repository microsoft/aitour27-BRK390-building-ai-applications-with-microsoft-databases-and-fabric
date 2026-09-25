# Act 3 security and publication review

Updated: 2026-09-25. Target: the Act 3 publication change based on
`main` at `11b72ae59e09f9c62da44c45c6b3db51bd6f4419`.

**Privacy, secret, language, local-runtime, and dependency-security gates pass.
Cloud sign-off is still required.**

## Current publication audit

| Gate | Result | Boundary |
| --- | --- | --- |
| Whole-publication scanner | PASS: 526 Git-eligible files | Exact pull-request tree |
| Gitleaks working-tree scan | PASS: no leaks | Current files |
| Gitleaks history scan | PASS | History through `origin/main`; candidate tree scanned separately |
| Personal-data classification | PASS | No personal email, phone, SSN, home path, tenant domain, or live deployment endpoint |
| Microsoft and competitor language review | PASS | No disparaging, adversarial, or comparative attack language |
| Root Node tests | PASS: 174/174 | Local tests and test doubles |
| Browser tests | PASS: 9/9 | Real local Functions host; identity and business APIs mocked where documented |
| Fabric data manifest | PASS: 95 files | Deterministic committed data payload |
| Fabric data validation | PASS: 322/322 | Structure, invariants, provenance, and disclosure checks |
| Act 3 npm audit | PASS: zero known vulnerabilities | Root runtime and generated deployment package |

The scanner recognizes nested `.env.example` files as templates, scans source,
infrastructure, lock, and notebook formats, distinguishes generated package
deprecation metadata from authored content, and excludes tracked files that are
deleted from the current publication tree. Its regression suite is part of the
174 Node tests.

## Privacy classification

- The named Caldova people and business records are synthetic demo fixtures.
- The content-owner names and profile links in the session README are intentional
  public ownership metadata.
- `opencode@microsoft.com`, `opensource@microsoft.com`, and
  `secure@microsoft.com` are public Microsoft shared mailboxes.
- Other email-shaped values use reserved example or test domains and occur only
  in tests or tool examples.
- The only literal GUIDs are a zero-valued test actor and the documented public
  Azure CLI client ID.
- No personal home-directory path, generated interactive output, Azure CLI state,
  tenant domain, daily-ring endpoint, live Function host, or live SQL/Cosmos/model
  endpoint is present.
- The banner's software metadata was removed without changing its visual dimensions.

Neutral implementation references such as font names and open-source package names
remain where technically relevant. The review found no wording that disparages
Microsoft, a Microsoft product, or another vendor.

## Dependency-security boundary

The Act 3 runtime package scans clean. Its lockfile is installed with `npm ci`
and audited independently from the other applications in this repository.

## Act 3 red-team repairs

| Finding | Repair |
| --- | --- |
| Signed JWT with malformed actor ID accepted; expiry was optional | Token verification requires `exp`, `iat`, `nbf`, `oid`, exact actor/tenant GUID syntax, issuer, and audience. |
| Inherited asset names reached the file handler | Asset lookup checks own properties; prototype, unknown-file, and traversal probes return 404. |
| Browser timeout was shorter than the SQL recovery budget | Client requests use 90 seconds, abort stalled bodies, and retain uncertain-write request IDs without automatic replay. |
| Speaker setup depended on undocumented source seeding | Setup now validates configuration and orders SQL, Cosmos, and staffing preparation. |
| Published source lagged the current staffing workflow | V3 scenario, provenance, assessment orchestration, web assets, preflight, isolated sessions, and rollback checks were synchronized. |
| Earlier alternate client contained real IDs and attribution leakage | The alternate client was removed from the publication repository; public defaults use environment variables and test IDs are sentinels. |
| Earlier snapshot lacked authentication | Reader-role enforcement and private generic errors have negative tests. |

V3 memory creation requires two explicit write guards, confirmed absence, one create,
and matching read-back. Existing IDs, conflicting content, timeouts, and uncertain
outcomes stop without overwrite or automatic retry. Rehearsals use new case IDs and
preserve prior approvals.

## Validation boundaries

- Cryptographic token tests use generated RSA keys and a test JWKS response. They
  do not certify an Entra app registration.
- Browser tests run Chromium against a real local Functions host. Signed-in tests
  replace identity and API responses only inside Playwright.
- Setup tests use test doubles for SQL, Cosmos, Azure OpenAI, and Azure management
  dependencies.
- No Azure resource, role assignment, app setting, database, or Cosmos document
  was changed during this review.
- Real SQL/Cosmos transactions, managed-identity permissions, model dimensions and
  budget, speaker sign-in, cold-resume timing, and committed plan read-back remain
  owner-run cloud gates.

Run the local gates from the repository root:

```sh
npm ci --ignore-scripts
npm test
npm run demo:scenario:check
npm run demo:memory
npm run demo:session -- --case-id SESSION-local-preview
npm run demo:package
npm run test:browser
npm run security:publication
npm audit --audit-level=moderate

node data/tools/manifest.ts --check
node data/tools/validate.ts
gitleaks dir . --redact --exit-code 1 --no-banner
gitleaks git . --redact --exit-code 1 --no-banner
```

The resource owner must still authorize the exact subscription, tenant, resource
group, Function app, Azure SQL database, Azure OpenAI deployment, Cosmos container,
identity grants, seed, application settings, deployment, and authenticated
preflight. A clean local package is not evidence of a successful live deployment.
