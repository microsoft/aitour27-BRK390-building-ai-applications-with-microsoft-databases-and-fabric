import {
  AudienceType,
  UserDataFunctions,
  type RayfinContext,
} from "@microsoft/fabric-user-data-functions";

const DATA_AGENT_TOOL = "DataAgent_CaldovaAnalyst";
const MCP_PROTOCOL_VERSION = "2025-06-18";

/**
 * The Fabric UDF host aborts an invocation at 250s, so the outbound call is
 * bounded below that to leave room for a diagnosable error to reach the caller.
 */
const MCP_REQUEST_TIMEOUT_MS = 180_000;

interface AgentAnswer {
  answer: string;
}

interface AgentDiagnostics {
  tokenAcquired: boolean;
  tokenAudience: string;
  tokenScopes: string;
  tokenExpiresAt: string;
  mcpStatus: number;
  mcpElapsedMs: number;
  mcpBodySnippet: string;
  failure: string;
}

interface McpResponse {
  status: number;
  body: string;
  elapsedMs: number;
}

const udf = new UserDataFunctions();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Reads only the non-secret `aud`, `scp`, and `exp` claims so a failing call can
 * report which audience the host issued the delegated token for. The token value
 * itself is never returned or logged.
 */
function describeToken(
  token: string,
): Pick<AgentDiagnostics, "tokenAudience" | "tokenScopes" | "tokenExpiresAt"> {
  const unparseable = {
    tokenAudience: "(unparseable)",
    tokenScopes: "(unparseable)",
    tokenExpiresAt: "(unparseable)",
  };

  const segments = token.split(".");
  if (segments.length < 2) {
    return unparseable;
  }

  try {
    const claims: unknown = JSON.parse(
      Buffer.from(segments[1], "base64url").toString("utf8"),
    );
    if (!isRecord(claims)) {
      return unparseable;
    }

    return {
      tokenAudience: typeof claims.aud === "string" ? claims.aud : "(absent)",
      tokenScopes: typeof claims.scp === "string" ? claims.scp : "(absent)",
      tokenExpiresAt:
        typeof claims.exp === "number"
          ? new Date(claims.exp * 1000).toISOString()
          : "(absent)",
    };
  } catch {
    return unparseable;
  }
}

/**
 * Posts one JSON-RPC message and returns the raw outcome. Transport failures name
 * the elapsed time and cause, because a bare timeout cannot distinguish a blocked
 * egress path from a slow agent.
 */
async function postMcpMessage(
  mcpUrl: string,
  token: string,
  message: Record<string, unknown>,
): Promise<McpResponse> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), MCP_REQUEST_TIMEOUT_MS);
  const startedAt = Date.now();

  try {
    const response = await fetch(mcpUrl, {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "MCP-Protocol-Version": MCP_PROTOCOL_VERSION,
      },
      body: JSON.stringify(message),
      signal: controller.signal,
    });

    return {
      status: response.status,
      body: await response.text(),
      elapsedMs: Date.now() - startedAt,
    };
  } catch (error) {
    const elapsedMs = Date.now() - startedAt;
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(
        `MCP request aborted after ${elapsedMs}ms (limit ${MCP_REQUEST_TIMEOUT_MS}ms) calling ${mcpUrl}.`,
      );
    }

    const cause =
      error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    throw new Error(
      `MCP transport failure after ${elapsedMs}ms calling ${mcpUrl} - ${cause}`,
    );
  } finally {
    clearTimeout(timeoutId);
  }
}

function parseJsonRpcBody(body: string): Record<string, unknown> {
  const eventPayloads = body
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trim())
    .filter(Boolean);
  const candidate = eventPayloads.at(-1) ?? body.trim();

  if (!candidate) {
    throw new Error("The Caldova data agent returned an empty response body.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    throw new Error(
      `The Caldova data agent returned a non-JSON response: ${candidate.slice(0, 200)}`,
    );
  }

  if (!isRecord(parsed)) {
    throw new Error(
      "The Caldova data agent returned an unexpected response envelope.",
    );
  }

  return parsed;
}

function extractAnswer(response: McpResponse): string {
  if (response.status !== 200) {
    throw new Error(
      `Caldova data agent returned HTTP ${response.status} after ${response.elapsedMs}ms: ${response.body.slice(0, 300)}`,
    );
  }

  const envelope = parseJsonRpcBody(response.body);

  if (isRecord(envelope.error)) {
    const message =
      typeof envelope.error.message === "string"
        ? envelope.error.message
        : JSON.stringify(envelope.error);
    throw new Error(`Caldova data agent rejected the request: ${message}`);
  }

  if (!isRecord(envelope.result) || !Array.isArray(envelope.result.content)) {
    throw new Error(
      `Caldova data agent returned no answer content: ${response.body.slice(0, 300)}`,
    );
  }

  const answer = envelope.result.content
    .filter(isRecord)
    .filter((block) => block.type === "text")
    .map((block) => (typeof block.text === "string" ? block.text : ""))
    .filter(Boolean)
    .join("\n\n")
    .trim();

  if (!answer) {
    throw new Error("The Caldova data agent returned an empty answer.");
  }

  return answer;
}

function buildToolCall(question: string): Record<string, unknown> {
    return {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
            name: DATA_AGENT_TOOL,
            arguments: {
                userQuestion: [
                    "You are answering inside the Caldova commercial operations dashboard.",
                    "Cover the whole product portfolio unless the user names a specific product.",
                    "Answer concisely in markdown. Use a table when comparing products, regions or campaigns.",
                    "Report figures with their units and state plainly when evidence is unavailable.",
                    "",
                    `Question: ${question}`,
                ].join("\n"),
            },
        },
    };
}

function requireDelegatedToken(ctx: RayfinContext): string {
  const token = ctx.getToken(AudienceType.Fabric);
  if (!token) {
    throw new Error(
      "The Fabric delegated token was empty. The 'Fabric' audience connection did not produce an on-behalf-of token.",
    );
  }
  return token;
}

/**
 * The agent endpoint is per-workspace, so it is supplied as deployment
 * configuration rather than baked into source. No default is committed: a wrong
 * inherited URL fails as an opaque 404 far from its cause, whereas an unset one
 * names its own fix here.
 */
function requireMcpUrl(ctx: RayfinContext): string {
  const mcpUrl = ctx.getSecret("DATA_AGENT_MCP_URL");
  if (!mcpUrl) {
    throw new Error(
      "Missing DATA_AGENT_MCP_URL. Set it for the deployed item with 'npx rayfin secret set DATA_AGENT_MCP_URL', or add it to rayfin/functions/local.settings.json under Values for local runs. Read the value with 'fabio data-agent mcp-url --workspace <workspace-id> --id <agent-id>'.",
    );
  }
  return mcpUrl;
}

udf.func(
  "askCaldovaAnalyst",
  async (question: string, ctx: RayfinContext): Promise<AgentAnswer> => {
    const token = requireDelegatedToken(ctx);
    const mcpUrl = requireMcpUrl(ctx);
    const response = await postMcpMessage(
      mcpUrl,
      token,
      buildToolCall(question),
    );
    return { answer: extractAnswer(response) };
  },
  [udf.connection({ audienceType: AudienceType.Fabric })],
);

/**
 * Reports why an agent call fails without throwing, so the failing phase -
 * configuration, token acquisition, transport, or HTTP status - is visible from
 * the client.
 */
udf.func(
  "diagnoseCaldovaAgent",
  async (ctx: RayfinContext): Promise<AgentDiagnostics> => {
    const report: AgentDiagnostics = {
      tokenAcquired: false,
      tokenAudience: "(not acquired)",
      tokenScopes: "(not acquired)",
      tokenExpiresAt: "(not acquired)",
      mcpStatus: 0,
      mcpElapsedMs: 0,
      mcpBodySnippet: "",
      failure: "",
    };

    let mcpUrl: string;
    try {
      mcpUrl = requireMcpUrl(ctx);
    } catch (error) {
      report.failure = `config: ${error instanceof Error ? error.message : String(error)}`;
      return report;
    }

    let token: string;
    try {
      token = requireDelegatedToken(ctx);
    } catch (error) {
      report.failure = `token: ${error instanceof Error ? error.message : String(error)}`;
      return report;
    }

    report.tokenAcquired = true;
    Object.assign(report, describeToken(token));

    try {
      const response = await postMcpMessage(
        mcpUrl,
        token,
        buildToolCall("Reply with the single word OK."),
      );
      report.mcpStatus = response.status;
      report.mcpElapsedMs = response.elapsedMs;
      report.mcpBodySnippet = response.body.slice(0, 400);
    } catch (error) {
      report.failure = `transport: ${error instanceof Error ? error.message : String(error)}`;
    }

    return report;
  },
  [udf.connection({ audienceType: AudienceType.Fabric })],
);
