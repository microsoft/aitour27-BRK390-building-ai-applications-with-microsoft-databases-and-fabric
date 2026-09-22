# Caldova — Commercial Operations

A Fabric-embedded Rayfin data app presenting commercial performance across the
Caldova product portfolio: sales, demand plan variance, regional contribution
and campaign delivery.

The dashboard is portfolio-wide by design. Every tracked product is measured
against the same baseline demand plan over the same rolling window, so a product
running away from plan is discovered by reading the data rather than by a
hardcoded filter.

## Panels

| Panel | Source |
| --- | --- |
| Headline metrics | `sales_order_lines` measures plus baseline plan variance |
| Revenue by category | Daily revenue across the whole catalogue |
| Performance against plan | `ForecastActualDaily` vs baseline forecast version |
| Regional variance | `ForecastActualDaily` by region |
| Campaign delivery | `CampaignSignals` telemetry |
| Analyst assistant | `CaldovaAnalyst` data agent via a Rayfin function |

### Two data caveats worth knowing

- **Plan comparisons use the *baseline* forecast version.** Later forecast
  versions have already absorbed observed uplift, so comparing against them
  understates variance against the original commitment.
- **Campaign performance is delivery to date, not the whole season.** Telemetry
  covers the launch plan's observed days only — the plan runs to 2026-11-26 but
  the dataset stops at the as-of boundary — so spend is a partial-season figure.
  It is not comparable to a full-campaign projection.

## Analyst assistant

The chat calls a Rayfin user data function, which acquires a delegated
on-behalf-of Fabric token and queries the published data agent over MCP. No
credentials are stored: the calling user's own identity authorises the request,
so a user only ever sees what they are entitled to see.

The agent endpoint is per-workspace, so it is supplied as configuration rather
than hardcoded. The function reads `DATA_AGENT_MCP_URL` via `ctx.getSecret` and
fails with an actionable error when it is unset — no default is committed,
because a wrong inherited URL surfaces as an opaque `404` far from its cause.

Read the value for a workspace with:

```bash
fabio data-agent mcp-url --workspace <workspace-id> --id <agent-id>
```

Set it for the deployed item:

```bash
npx rayfin secret set DATA_AGENT_MCP_URL
# or add RAYFIN_SECRET_DATA_AGENT_MCP_URL=<url> to rayfin/.env, then:
npx rayfin up secrets apply
```

For local function debugging, add `DATA_AGENT_MCP_URL` to
`rayfin/functions/local.settings.json` under `Values`; `ctx.getSecret` falls
back to `process.env`. That file is gitignored.

## Fabric connection profiles

`fabric.yaml` carries one profile per target workspace. It is **not tracked in
git**, because it holds workspace-specific coordinates. Seed it from the
committed template on first checkout:

```bash
cp fabric.example.yaml fabric.yaml   # then fill in your workspace/item ids
```

Without it the build stops at its first step with
`Config file 'fabric.yaml' not found`, because `npm run build` runs
`fabric-app-data generate` and `src/lib/fabric-client.ts` imports the result.

The template ships a single `default` profile. Add one profile per target
workspace if you deploy to more than one, and switch between them with:

```bash
node node_modules/@microsoft/fabric-app-data-cli/dist/index.js use <profile> -o src/fabric.generated.ts
```

Two traps in that command, both learned the hard way:

- **Do not invoke this CLI through `npx` or `node_modules/.bin`.**
  `fabric-app-data-cli@2.0.0` guards its entrypoint with
  `resolve(process.argv[1]) === fileURLToPath(import.meta.url)`. Run through the
  `.bin` symlink those two paths differ, so the CLI **exits 0 and does nothing** —
  no output, no file, no error. The `build` scripts call the real `dist/index.js`
  path for the same reason.
- **Pass `-o` explicitly.** Without it the CLI writes `fabric.generated.ts` to
  the project root instead of `src/`.

### Two switches, and they must agree

Targeting a different workspace means changing **two independent things**:

| Command | Controls |
| --- | --- |
| `fabric-app-data use <profile>` | the semantic model workspace/item ids baked into the bundle |
| `npx rayfin up switch <deployment>` | the Rayfin backend URL, publishable key and item id |

They are not linked. Changing one without the other produces an app served from
one workspace while querying another — which fails at query time, not at build
time, because `build:fabric` happily bakes whichever profile is active into
`fabric.generated.ts` and `src/lib/fabric-client.ts` reads it verbatim.

So switch the profile **before** deploying, and confirm the ids afterwards:

```bash
node node_modules/@microsoft/fabric-app-data-cli/dist/index.js use <profile> -o src/fabric.generated.ts
grep workspaceId src/fabric.generated.ts
```

The `DATA_AGENT_MCP_URL` secret is also **per deployed item**, so it does not
travel with a profile switch. Each workspace needs its own — see the Analyst
assistant section above.

## Commands

```bash
cp fabric.example.yaml fabric.yaml   # first checkout only
npm install
npm run lint
npm test
npm run build
npm --prefix rayfin/functions run build
```

### Working on the layout

The app expects the Fabric portal embed for authentication, so it cannot be
opened directly on localhost. To iterate on the UI, a preview harness renders the
real dashboard against fixtures that mirror the live query shapes:

```bash
npm run preview:layout
```

### Deploying

```bash
npx rayfin up --workspace-uri "<Fabric workspace URL>"
```

Pass the portal URL of the target ring — `rayfin up` derives both the workspace
id **and the service endpoint** from it. Deploying to the internal daily ring
therefore needs the daily host:

```bash
npx rayfin up --workspace-uri "https://daily.fabric.microsoft.com/groups/<workspace-id>/list"
```

`rayfin secret set` has no equivalent option and always talks to production, so
against a non-production ring it fails with a misleading
`404 Could not found the requested item`. Override the endpoint for those calls:

```bash
export RAYFIN_FABRIC_API_URL="https://dailyapi.fabric.microsoft.com/v1"
export RAYFIN_FABRIC_PORTAL_URL="https://daily.fabric.microsoft.com/"
```

Two further notes:

- `rayfin up` **appends** the deployment's static hosting origin to
  `services.auth.allowedRedirectUris` in `rayfin.yml` and rewrites the file. It
  appends rather than replaces, so origins from other workspaces survive — but
  it does mean a deploy produces a tracked-file diff you did not write.
- `rayfin up secrets apply` is not a real subcommand. It silently falls through
  to a plain `rayfin up`, which then fails on workspace resolution. Use
  `rayfin secret set`.
- `rayfin secret list` prints nothing without `--json`.
