import { createHash } from "node:crypto";

/**
 * HTTP caching for read endpoints whose answer is the same for everyone who
 * isn't signed in (catalog pages, problem lists, public profiles).
 *
 * For a GET to a listed route WITHOUT an Authorization header that succeeds:
 *   Cache-Control: public, max-age=<maxAge>, s-maxage=<sMaxAge>, stale-while-revalidate=<swr>
 *   ETag (weak, from the body), and 304 Not Modified when If-None-Match matches.
 * A CDN in front (Cloudflare, CloudFront, ...) then serves most anonymous
 * traffic without reaching the service.
 *
 * Responses to signed-in requests carry the learner's own progress, so they
 * get `Cache-Control: private, no-store` and are never shared. Every listed
 * route also sends `Vary: Authorization` so shared caches keep them apart.
 */

export interface CacheRule {
  /** Seconds browsers may reuse the response. */
  maxAge: number;
  /** Seconds shared caches (CDN) may reuse it. Default: maxAge. */
  sMaxAge?: number;
  /** Seconds a stale copy may be served while it is refreshed. Default: 2 × sMaxAge. */
  staleWhileRevalidate?: number;
}

/** Content only changes on deploy: short browser TTL, longer CDN TTL. */
export const CATALOG_CACHE: CacheRule = { maxAge: 60, sMaxAge: 300 };

interface HookRequest {
  method: string;
  headers: Record<string, string | string[] | undefined>;
  routeOptions?: { url?: string };
}
interface HookReply {
  statusCode: number;
  header: (name: string, value: string) => unknown;
  code: (status: number) => unknown;
}

export function weakEtag(body: string | Buffer) {
  return `W/"${createHash("sha1").update(body).digest("base64url").slice(0, 27)}"`;
}

export function cacheControl(rule: CacheRule) {
  const sMaxAge = rule.sMaxAge ?? rule.maxAge;
  const swr = rule.staleWhileRevalidate ?? sMaxAge * 2;
  return `public, max-age=${rule.maxAge}, s-maxage=${sMaxAge}, stale-while-revalidate=${swr}`;
}

/**
 * Adds the caching hook to a Fastify app. `rules` maps route patterns as
 * registered (e.g. "/api/v1/arena/items/:itemId") to their cache rule.
 */
export function registerPublicCache(
  app: { addHook: (name: "onSend", hook: (req: any, reply: any, payload: unknown) => Promise<unknown>) => unknown },
  rules: Record<string, CacheRule>,
) {
  app.addHook("onSend", async (request: HookRequest, reply: HookReply, payload: unknown) => {
    if (request.method !== "GET" && request.method !== "HEAD") return payload;
    const rule = request.routeOptions?.url ? rules[request.routeOptions.url] : undefined;
    if (!rule) return payload;

    reply.header("Vary", "Authorization");
    if (request.headers.authorization) {
      reply.header("Cache-Control", "private, no-store");
      return payload;
    }
    if (reply.statusCode !== 200 || (typeof payload !== "string" && !Buffer.isBuffer(payload))) return payload;

    const etag = weakEtag(payload);
    reply.header("Cache-Control", cacheControl(rule));
    reply.header("ETag", etag);
    const ifNoneMatch = request.headers["if-none-match"];
    if (typeof ifNoneMatch === "string" && ifNoneMatch.split(",").some((t) => t.trim() === etag)) {
      reply.code(304);
      return "";
    }
    return payload;
  });
}
