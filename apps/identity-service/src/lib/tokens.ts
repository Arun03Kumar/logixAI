import { createHash, randomBytes } from "node:crypto";
import {
  SignJWT,
  exportJWK,
  generateKeyPair,
  importPKCS8,
  type JWK,
  type KeyLike,
} from "jose";
import { ACCESS_TOKEN_AUDIENCE, type AccessTokenClaims } from "@logixai/contracts";

const ALG = "EdDSA";

export interface TokenIssuer {
  /** Signs a short-lived access token (JWT). */
  issueAccessToken(claims: AccessTokenClaims): Promise<string>;
  /** Public keys for other services to verify tokens (served as JWKS). */
  jwks(): { keys: JWK[] };
  accessTokenTtlSeconds: number;
}

/**
 * Creates the signer. With no private key (development), an Ed25519 key pair
 * is generated for this process; access tokens then stop verifying after a
 * restart, and the browser silently refreshes them.
 */
export async function createTokenIssuer(options: {
  privateKeyPem?: string;
  keyId: string;
  issuer: string;
  accessTokenTtlSeconds: number;
}): Promise<TokenIssuer> {
  let privateKey: KeyLike;
  let publicJwk: JWK;

  if (options.privateKeyPem) {
    privateKey = await importPKCS8(options.privateKeyPem.replace(/\\n/g, "\n"), ALG, {
      extractable: true,
    });
    const full = await exportJWK(privateKey);
    // Strip the private part ("d") to publish only the public key.
    const { d: _d, ...pub } = full;
    publicJwk = pub;
  } else {
    const pair = await generateKeyPair(ALG, { crv: "Ed25519" });
    privateKey = pair.privateKey;
    publicJwk = await exportJWK(pair.publicKey);
  }
  publicJwk = { ...publicJwk, kid: options.keyId, alg: ALG, use: "sig" };

  return {
    accessTokenTtlSeconds: options.accessTokenTtlSeconds,
    jwks: () => ({ keys: [publicJwk] }),
    issueAccessToken: (claims) =>
      new SignJWT({ role: claims.role, name: claims.name, email: claims.email })
        .setProtectedHeader({ alg: ALG, kid: options.keyId })
        .setSubject(claims.sub)
        .setIssuer(options.issuer)
        .setAudience(ACCESS_TOKEN_AUDIENCE)
        .setIssuedAt()
        .setExpirationTime(`${options.accessTokenTtlSeconds}s`)
        .sign(privateKey),
  };
}

/** Opaque refresh token for the cookie; only its hash is stored. */
export function newRefreshToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Short human-friendly invite code, e.g. "K7QM-2XPA". No 0/O/1/I. */
export function newInviteCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(8);
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += alphabet[bytes[i]! % alphabet.length];
    if (i === 3) code += "-";
  }
  return code;
}
