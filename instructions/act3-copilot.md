# Deploy Act 3 with an AI coding agent

Use this prompt from the repository root:

```text
Prepare the BRK390 Act 3 staffing demo.

1. Read AGENTS.md, instructions/act3.md, .env.example, and
   src/act3/README.md.
2. Verify Node.js 24+, npm, Azure CLI, and Azure Functions Core Tools v4.
3. Confirm that .env exists and is ignored. Do not print its values.
4. Run npm ci and npm run demo:prepare.
5. Report the build/act3-deploy path and any missing configuration.
6. Before running a command that changes Azure, show me the exact subscription,
   resource, and command, then wait for confirmation.
7. For a new environment, run npm run demo:seed only after confirmation.
8. Package and publish the Function, then run npm run demo:preflight and
   npm run demo:auth-check.
9. Use a new SESSION- or REHEARSAL- case for every rehearsal. Do not overwrite
   the V3 Cosmos memory or retry a write whose result is unknown.
10. Report which checks ran locally and which results came from the deployed
    Azure application.
```

## Safe defaults

- Local tests, previews, configuration checks, and packaging do not change
  Azure.
- `CALDOVA_ALLOW_CLOUD_WRITES` and
  `CALDOVA_SYNTHETIC_SOURCE_CONFIRMED` stay `false` except while seeding or
  creating a rehearsal case.
- Keep `.env`, tokens, tenant IDs, deployment output, receipts, screenshots,
  and recordings out of Git.
- Follow the deployment sequence in [Act 3 setup](act3.md).
