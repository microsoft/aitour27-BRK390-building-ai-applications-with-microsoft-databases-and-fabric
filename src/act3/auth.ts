import { createRemoteJWKSet, jwtVerify } from "jose";

const guid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export type ApprovalIdentity = {
  objectId: string;
  roles: string[];
};

export interface AccessTokenVerifier {
  verify(authorization: string | undefined): Promise<ApprovalIdentity>;
}

export type EntraVerifierConfig = {
  tenantId: string;
  audience: string;
};

export type BrowserAuthConfig = {
  tenantId: string;
  clientId: string;
  apiScope: string;
};

export function loadEntraVerifierConfig(env: NodeJS.ProcessEnv): EntraVerifierConfig {
  const tenantId = env.ENTRA_TENANT_ID?.trim();
  const audience = env.ENTRA_API_AUDIENCE?.trim();
  if (!tenantId || !audience) {
    throw new Error("ENTRA_TENANT_ID and ENTRA_API_AUDIENCE are required.");
  }
  return { tenantId, audience };
}

export function loadBrowserAuthConfig(env: NodeJS.ProcessEnv): BrowserAuthConfig {
  const tenantId = env.ENTRA_TENANT_ID?.trim();
  const clientId = env.ENTRA_CLIENT_ID?.trim();
  const apiScope = env.ENTRA_API_SCOPE?.trim();
  if (!tenantId || !clientId || !apiScope) {
    throw new Error("ENTRA_TENANT_ID, ENTRA_CLIENT_ID, and ENTRA_API_SCOPE are required.");
  }
  return { tenantId, clientId, apiScope };
}

export class EntraAccessTokenVerifier implements AccessTokenVerifier {
  readonly #issuer: string;
  readonly #audience: string;
  readonly #keys: ReturnType<typeof createRemoteJWKSet>;

  constructor(config: EntraVerifierConfig) {
    if (!guid.test(config.tenantId)) {
      throw new Error("ENTRA_TENANT_ID must be a tenant GUID.");
    }
    this.#issuer = `https://login.microsoftonline.com/${config.tenantId}/v2.0`;
    this.#audience = config.audience;
    this.#keys = createRemoteJWKSet(
      new URL(`https://login.microsoftonline.com/${config.tenantId}/discovery/v2.0/keys`),
    );
  }

  async verify(authorization: string | undefined): Promise<ApprovalIdentity> {
    const match = /^Bearer ([^\s]+)$/i.exec(authorization ?? "");
    if (!match) throw new Error("A bearer access token is required.");

    const { payload } = await jwtVerify(match[1], this.#keys, {
      issuer: this.#issuer,
      audience: this.#audience,
      algorithms: ["RS256"],
      requiredClaims: ["exp", "iat", "nbf", "oid"],
    });
    const objectId = payload.oid;
    const roles = payload.roles;
    if (typeof objectId !== "string" || !guid.test(objectId) || !Array.isArray(roles) || !roles.every((role) => typeof role === "string")) {
      throw new Error("The access token must contain oid and roles claims.");
    }
    return { objectId, roles };
  }
}