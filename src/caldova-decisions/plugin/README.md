# Campaign agent for Copilot Cowork

Tim asks and approves in Cowork. The skill directs the conversation, a Streamable
HTTP MCP connector exposes five tools, and HorizonDB executes the AI Pipelines.
The web interface is a supporting decision/evidence/pipeline inspector.

## Tools

| Tool | Responsibility |
| --- | --- |
| `evaluate_campaign` | Queue a six-week Hydration Sunscreen request with a USD budget ceiling |
| `get_campaign_proposal` | Read progress, calculated scenarios, evidence and brief |
| `approve_campaign_plan` | Record explicit approval of the reviewed version |
| `get_production_request` | Return the queued request and message for Karin |
| `get_ai_workflow` | Inspect deployed definitions and this job's durable runs |

Requests return promptly; a separate worker processes model calls. The worker uses
a PostgreSQL advisory lock and records durable instance IDs. Stable request keys
prevent duplicate evaluation when a client retries identical inputs. Do not run
manual SQL walkthroughs concurrently with the worker.

## Configure authentication and HTTPS

1. Set the component's PostgreSQL variables; use `~/.pgpass` for the password.
2. Create the API registration in your selected Azure CLI tenant:

   ```sh
   uv run python scripts/setup-entra.py --create
   ```

3. Create an OAuth client registration with the Teams callback
   `https://teams.microsoft.com/api/platform/v1.0/oAuthRedirect`. Grant the client
   delegated access to `api://YOUR_API_CLIENT_ID/Campaign.Access`.
4. In Teams Developer Portal → Tools → OAuth client registration, configure the
   client ID/secret, tenant-specific authorization/token endpoints, API base URL,
   and scope `api://YOUR_API_CLIENT_ID/Campaign.Access offline_access`. Enable PKCE.
   Use **Any Teams app**; obtain the vault's OAuth registration ID.
5. Provide an HTTPS tunnel to local port 8000. Dev Tunnels forwards local **HTTP**;
   the relay terminates TLS. Use the actual host printed by the tunnel, not its name.
6. Copy `plugin/connection.example.json` to ignored `plugin/connection.json` and
   fill in the deployment values. Configure `AUTH_MODE=entra` for remote access.

```sh
uv run --env-file .env python scripts/run-cowork.py
# Separate terminal, after authenticating Dev Tunnels:
devtunnel host YOUR_TUNNEL_ID
```

The endpoint is `https://YOUR_HTTPS_HOST/mcp/`. Entra validation checks signature,
issuer, audience, expiry, scope and tenant/user identity. The Cowork User-Agent is
not identity. Local mode accepts loopback connections only and rejects forwarded
requests. The remote inspection page accepts a delegated token in memory; browser
SSO is not implemented there. The Cowork connector manages its own OAuth sign-in.

`scripts/configure-cowork-client.py` is an optional macOS-only helper for filling
the visible Developer Portal form in a signed-in Edge session. It requires explicit
browser automation permission. Manual registration works on other platforms.

## Package and install

```sh
uv run python scripts/package-plugin.py \
  --base-url https://YOUR_HTTPS_HOST \
  --oauth-reference YOUR_M365_OAUTH_REGISTRATION_ID \
  --website https://YOUR_DEVELOPER_SITE \
  --privacy-url https://YOUR_DEVELOPER_SITE/privacy \
  --terms-url https://YOUR_DEVELOPER_SITE/terms
```

The result is ignored `dist/caldova-cowork.zip`: Microsoft 365 manifest v1.28,
correctly sized icons, the skill, and tool descriptions exported from the MCP server.
Archive-relative paths exactly match the manifest (no leading `./`), addressing a
literal-path validation issue observed in Cowork. Only configuration IDs, never
client secrets, belong in the manifest.

Install privately through **Cowork → Customize → Plugins → Add plugin → Only you**.
Enable it under Sources & Skills and authenticate as the demo user. Tenant custom
app permissions, Copilot entitlements and Cowork spending-policy access must be
configured by the administrator. Do not assume a Copilot license alone enables
Cowork; consult current Microsoft documentation. No billing configuration is
automatically created by these scripts.

## Agent-led acceptance sequence

1. Tim: “If we invest up to $30,000 more in Hydration Sunscreen over the next six
   weeks, which regions should we prioritise and what demand should we expect?”
2. Agent evaluates, polls, then presents the actual scenario and its evaluation ID.
3. Open the returned evidence link and inspect the AI pipeline steps if desired.
4. Tim: “Approve that marketing plan and prepare Karin's capacity review.”
5. Agent approves the same version and returns Karin's saved conversation starter.

The production request is **queued**, not delivered to Teams by this plugin.
The factory bot is a separate Teams app; see [its guide](../factory_agent/README.md).

Approval requires a 30-minute review token bound to the user, evaluation, source
hash and brief hash, plus explicit user confirmation. A token is not by itself
proof of human intent: the skill and Cowork write-action confirmation supply the
human step. Changed inputs require a fresh review. The database retains the SQL
execution role; `agent_reviews` records the authenticated user separately.

## Verification and recovery

Run `uv run pytest -q tests/test_agent.py` for local MCP/auth/package checks.
The opt-in live test creates a business-named campaign and verifies actual pipeline
execution, ownership, duplicate approval and Karin's queued message.

Inspect `agent_jobs` and `agent_run_links` for failures. Fix the cause and use a
fresh request key. Do not invent a recommendation when a database/model call fails.
If a model rate limit occurs, inspect `df.nodes.result`; automatic recovery was
not guaranteed in the tested preview.

References:
- https://learn.microsoft.com/microsoft-365/copilot/cowork/cowork-plugin-development
- https://learn.microsoft.com/microsoft-365/copilot/extensibility/plugin-authentication-oauth
- https://learn.microsoft.com/microsoft-365/copilot/cowork/cowork-access
