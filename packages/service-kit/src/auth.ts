import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import {
  ACCESS_TOKEN_AUDIENCE,
  DEFAULT_TOKEN_ISSUER,
  PlatformRoleSchema,
  type AccessTokenClaims,
} from "@logixai/contracts";
import { ForbiddenError, UnauthorizedError } from "./errors";

export interface AccessTokenVerifier {
  /** Verifies a raw JWT. Throws UnauthorizedError when invalid or expired. */
  verify(token: string): Promise<AccessTokenClaims>;
  /** Reads `Authorization: Bearer <jwt>` and verifies it. */
  verifyHeader(header: string | string[] | undefined): Promise<AccessTokenClaims>;
}

/**
 * Verifies access tokens issued by identity-service using its public keys
 * (fetched from the JWKS URL and cached). Services never need the private key.
 */
export function createAccessTokenVerifier(options: {
  jwksUrl: string;
  issuer?: string;
  /** For tests: supply keys directly instead of fetching the JWKS. */
  keys?: JWTVerifyGetKey;
}): AccessTokenVerifier {
  const keys = options.keys ?? createRemoteJWKSet(new URL(options.jwksUrl));
  const issuer = options.issuer ?? DEFAULT_TOKEN_ISSUER;

  async function verify(token: string): Promise<AccessTokenClaims> {
    try {
      const { payload } = await jwtVerify(token, keys, {
        issuer,
        audience: ACCESS_TOKEN_AUDIENCE,
      });
      const role = PlatformRoleSchema.safeParse(payload.role);
      if (typeof payload.sub !== "string" || !role.success) {
        throw new Error("missing claims");
      }
      return {
        sub: payload.sub,
        role: role.data,
        name: String(payload.name ?? ""),
        email: String(payload.email ?? ""),
      };
    } catch {
      throw new UnauthorizedError("Your session has expired. Sign in again.");
    }
  }

  return {
    verify,
    async verifyHeader(header) {
      const value = Array.isArray(header) ? header[0] : header;
      const match = /^Bearer\s+(.+)$/i.exec(value ?? "");
      if (!match?.[1]) throw new UnauthorizedError();
      return verify(match[1].trim());
    },
  };
}

/** Throws ForbiddenError unless the caller has the platform role. */
export function requirePlatformRole(
  claims: AccessTokenClaims,
  role: AccessTokenClaims["role"],
): void {
  if (claims.role !== role) {
    throw new ForbiddenError();
  }
}
