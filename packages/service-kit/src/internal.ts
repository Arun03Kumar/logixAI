import { timingSafeEqual } from "node:crypto";

/** Header carrying the shared secret on service-to-service calls. */
export const INTERNAL_TOKEN_HEADER = "x-internal-token";

/**
 * True when a request carries the shared internal token. With no token
 * configured (local development) every request counts as internal; services
 * refuse to start in production without one (see their config).
 */
export function isInternalRequest(
  expected: string | undefined,
  header: string | string[] | undefined,
): boolean {
  if (!expected) return true;
  const given = Buffer.from(String(Array.isArray(header) ? header[0] : (header ?? "")));
  const want = Buffer.from(expected);
  return given.length === want.length && timingSafeEqual(given, want);
}

/** Headers to send on an internal call (empty when no token is configured). */
export function internalHeaders(token: string | undefined): Record<string, string> {
  return token ? { [INTERNAL_TOKEN_HEADER]: token } : {};
}
