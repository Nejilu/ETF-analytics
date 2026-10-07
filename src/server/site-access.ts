import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

export interface SiteAccess {
  mode: "local" | "web";
  owner: boolean;
  ownerOrigin: string;
  publicOrigin: string;
}

export class AccessError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

function origin(value: string | undefined): string {
  try {
    const url = new URL(value ?? "");
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    )
      throw new Error();
    return url.origin;
  } catch {
    throw new AccessError(503, "Site access is not configured.");
  }
}

export function siteConfiguration() {
  const publicOrigin = origin(process.env.SITE_PUBLIC_ORIGIN);
  const ownerOrigin = origin(process.env.SITE_OWNER_ORIGIN);
  const issuer = origin(process.env.CF_ACCESS_TEAM_DOMAIN);
  const audience = process.env.CF_ACCESS_AUD?.trim();
  const email = process.env.SITE_OWNER_EMAIL?.trim().toLowerCase();
  if (
    publicOrigin === ownerOrigin ||
    !audience ||
    !email ||
    !new URL(issuer).hostname.endsWith(".cloudflareaccess.com")
  ) {
    throw new AccessError(503, "Site access is not configured.");
  }
  return { publicOrigin, ownerOrigin, issuer, audience, email };
}

const keySets = new Map<string, JWTVerifyGetKey>();

export function siteAccessMode(): "local" | "cloudflare" {
  const configured = process.env.SITE_ACCESS_MODE?.trim();
  if (configured === "local" || configured === "cloudflare") return configured;
  if (configured) throw new AccessError(503, "Invalid site access mode.");
  // Existing web installations must never fall back to unauthenticated access
  // because one setting is missing. A fresh local installation needs no setup.
  return ["SITE_PUBLIC_ORIGIN", "SITE_OWNER_ORIGIN", "CF_ACCESS_TEAM_DOMAIN", "CF_ACCESS_AUD", "SITE_OWNER_EMAIL"]
    .some((key) => process.env[key]?.trim()) ? "cloudflare" : "local";
}

export async function verifyOwnerToken(
  token: string,
  config: ReturnType<typeof siteConfiguration>,
  keys?: JWTVerifyGetKey,
) {
  let keySet = keys ?? keySets.get(config.issuer);
  if (!keySet) {
    keySet = createRemoteJWKSet(
      new URL(`${config.issuer}/cdn-cgi/access/certs`),
    );
    keySets.set(config.issuer, keySet);
  }
  const { payload } = await jwtVerify(token, keySet, {
    issuer: config.issuer,
    audience: config.audience,
    algorithms: ["RS256"],
    requiredClaims: ["exp", "iat", "sub", "email"],
  });
  if (
    typeof payload.email !== "string" ||
    payload.email.toLowerCase() !== config.email
  ) {
    throw new AccessError(403, "Owner access required.");
  }
}

export async function getSiteAccess(headers: Headers): Promise<SiteAccess> {
  const host = headers.get("host")?.toLowerCase() ?? "";
  if (siteAccessMode() === "local") {
    if (
      !/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host)
    ) {
      throw new AccessError(
        403,
        "Local mode is restricted to loopback hosts.",
      );
    }
    if (process.env.SITE_LOCAL_PUBLIC_PREVIEW === "true") {
      if (process.env.NODE_ENV === "production") {
        throw new AccessError(503, "Public preview is available in development only.");
      }
      const url = new URL(`http://${host}`);
      const port = url.port ? `:${url.port}` : "";
      const owner = url.hostname !== "127.0.0.1";
      return {
        mode: "web",
        owner,
        publicOrigin: `http://127.0.0.1${port}`,
        ownerOrigin: owner ? url.origin : `http://localhost${port}`,
      };
    }
    return {
      mode: "local",
      owner: true,
      publicOrigin: `http://${host}`,
      ownerOrigin: `http://${host}`,
    };
  }
  const config = siteConfiguration();
  if (host === new URL(config.publicOrigin).host)
    return { ...config, mode: "web", owner: false };
  if (host !== new URL(config.ownerOrigin).host)
    throw new AccessError(403, "Unknown site host.");
  const token = headers.get("cf-access-jwt-assertion");
  if (!token) throw new AccessError(403, "Owner access required.");
  try {
    await verifyOwnerToken(token, config);
  } catch {
    throw new AccessError(403, "Owner access required.");
  }
  return { ...config, mode: "web", owner: true };
}

export function requireOwner(access: SiteAccess, request: Request) {
  if (!access.owner) throw new AccessError(403, "Owner access required.");
  if (
    !["GET", "HEAD"].includes(request.method) &&
    (request.headers.get("origin") !== access.ownerOrigin ||
      request.headers.get("sec-fetch-site") === "cross-site")
  ) {
    throw new AccessError(403, "Invalid request origin.");
  }
}
