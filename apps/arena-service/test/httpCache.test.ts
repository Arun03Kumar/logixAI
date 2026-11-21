import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { UnauthorizedError, type AccessTokenVerifier } from "@logixai/service-kit";
import { buildApp } from "../src/app.js";
import { loadCatalog } from "../src/content/catalog.js";
import { createMemoryStore } from "../src/store/memoryStore.js";

/* Signed-out catalog reads are cacheable by browsers and a CDN; signed-in ones never are. */

const CONTENT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "content");

const verifier: AccessTokenVerifier = {
  async verify(token) {
    return { sub: token, role: "user", name: token, email: `${token}@x.com`, plan: "free", planUntil: null };
  },
  async verifyHeader(header) {
    const token = String(header ?? "").replace(/^Bearer /, "");
    if (!token) throw new UnauthorizedError();
    return this.verify(token);
  },
};

let app: FastifyInstance;
beforeAll(async () => {
  ({ app } = await buildApp({
    catalog: loadCatalog(CONTENT),
    store: createMemoryStore(),
    judge: { submit: async () => {} },
    identity: { getMembership: async () => null, myMemberships: async () => [], listBatches: async () => [], listBatchMembers: async () => [] },
    verifier,
    corsOrigins: [],
  }));
});

const get = (url: string, headers: Record<string, string> = {}) => app.inject({ method: "GET", url: `/api/v1/arena${url}`, headers });

describe("HTTP caching", () => {
  it("lets shared caches keep signed-out catalog reads, with an ETag", async () => {
    const res = await get("/tracks?area=ml");
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("public, max-age=60, s-maxage=300, stale-while-revalidate=600");
    expect(res.headers.vary).toContain("Authorization");
    expect(res.headers.etag).toMatch(/^W\/"/);

    // Same content -> same ETag -> 304 with no body.
    const again = await get("/tracks?area=ml", { "if-none-match": String(res.headers.etag) });
    expect(again.statusCode).toBe(304);
    expect(again.body).toBe("");

    // Different content -> different ETag.
    const other = await get("/tracks?area=frontend");
    expect(other.headers.etag).not.toBe(res.headers.etag);
  });

  it("never shares a signed-in response (it carries the learner's progress)", async () => {
    const res = await get("/tracks?area=ml", { authorization: "Bearer u1" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("private, no-store");
    expect(res.headers.etag).toBeUndefined();
    expect(res.headers.vary).toContain("Authorization");
  });

  it("covers item pages, uses short lifetimes for contests, and leaves errors and personal routes alone", async () => {
    const item = await get("/items/m1s9-standard-error");
    expect(item.headers["cache-control"]).toContain("public");

    const contests = await get("/contests");
    expect(contests.headers["cache-control"]).toBe("public, max-age=15, s-maxage=30, stale-while-revalidate=60");

    const missing = await get("/items/does-not-exist");
    expect(missing.statusCode).toBe(404);
    expect(missing.headers["cache-control"]).toBeUndefined();

    const dashboard = await get("/me/dashboard", { authorization: "Bearer u1" });
    expect(dashboard.headers["cache-control"]).toBeUndefined();
  });
});
