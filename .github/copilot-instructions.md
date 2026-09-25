# BRK390 repository instructions

Work only in the area requested by the user. For Act 3, read `AGENTS.md`,
`docs/act3.md`, `instructions/act3.md`, and
`.github/skills/caldova-demo/SKILL.md` before changing or running anything.

- Use Node.js 24 or later. TypeScript is executed directly with native type
  stripping; do not add a TypeScript build step.
- Keep `data/scenario.json` frozen. Regenerate and check the separate staffing
  scenario with the repository scripts.
- Run `npm ci` and `npm run demo:prepare` for local Act 3 preparation.
- Treat Azure provisioning, Entra changes, role assignments, cloud seed,
  application settings, deployment, and authenticated preflight as owner-only
  mutations. Require explicit authorization for the exact target and command.
- Never print or commit secrets, tokens, tenant/account identifiers, `.env`,
  `local.settings.json`, receipts, screenshots, recordings, or generated builds.
- Never weaken authentication, role checks, source hashes, SQL
  parameterization, create-once memory behavior, idempotency, or uncertain-write
  handling.
- Never reset an approved case or overwrite retained V3 memory. Use a new
  `SESSION-` or `REHEARSAL-` case for another run.
- A package build is not a deployed or observed demo. Report evidence states
  accurately.
