---
name: demo-security-review
description: "Use when: reviewing demo security, publishing code, integrating demo artifacts, scanning for PII or secrets, or checking authentication and write safety."
---

# Demo Security Review

Review the actual publication set, including tracked files. Ignore rules do not
remove already-tracked content. Do not print secrets or personal values in findings.

1. Run `npm run security:publication`. It fails on private paths, home paths,
   personal email patterns, populated notebook outputs and unreviewed binary archives.
2. Run `node scripts/check-publication.mjs --export`, then
   `gitleaks dir build/publication --redact --exit-code 1`. Never scan private auth
   caches to create a public report. Keep detailed findings under ignored `tmp/`.
3. Run `gitleaks git . --redact --exit-code 1` to inspect locally available history.
   History is a separate scope: clean new files do not sanitize old commits. Do not
   rewrite history, revoke secrets or push without an explicit owner request.
4. Run `npm audit` and audit the resolved Python environment with `pip-audit`.
   Fix patchable findings and test compatibility; do not lower the audit threshold.
5. Review token issuer/audience/expiry/signature, per-operation roles, SQL parameters,
   idempotency, context binding, least privilege, origin/redirect checks, and errors.
6. Verify negative controls: no token, wrong role, stale case, missing source,
   dependency failure and uncertain write. Tests use injected doubles, never cloud writes.
7. Inspect any new image visually and review metadata. Office archives, recordings,
   screenshots and notebook outputs need separate privacy approval before inclusion.
8. Publish a findings-first report with fixes, commands, scope and remaining limits.
   Pattern scans do not prove that arbitrary free text or pixels contain no PII.

The retained synthetic persona registry is not live user data. Real account IDs,
emails, tenant-specific configuration and execution receipts remain private.