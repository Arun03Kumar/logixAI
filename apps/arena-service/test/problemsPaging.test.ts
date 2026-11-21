import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { UnauthorizedError, encodeCursor, type AccessTokenVerifier } from "@logixai/service-kit";
import { buildApp } from "../src/app.js";
import { loadCatalog, type Catalog } from "../src/content/catalog.js";
import { createMemoryStore } from "../src/store/memoryStore.js";

/* GET /problems is paged: 50 by default, totals and tags over every match. */

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

let catalog: Catalog;
let app: FastifyInstance;
beforeAll(async () => {
  catalog = loadCatalog(CONTENT);
  ({ app } = await buildApp({
    catalog,
    store: createMemoryStore(),
    judge: { submit: async () => {} },
    identity: { getMembership: async () => null, myMemberships: async () => [], listBatches: async () => [], listBatchMembers: async () => [] },
    verifier,
    corsOrigins: [],
  }));
});

const get = async (query: string) => {
  const res = await app.inject({ method: "GET", url: `/api/v1/arena/problems?${query}` });
  return { status: res.statusCode, data: res.json().data };
};

/** Follows nextCursor to the end. */
async function walk(query: string) {
  const ids: string[] = [];
  const pages = [];
  let cursor: string | null = null;
  do {
    const page: { items: { id: string }[]; nextCursor: string | null; total: number; tags: unknown[] } = (
      await get(`${query}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`)
    ).data;
    pages.push(page);
    ids.push(...page.items.map((i: { id: string }) => i.id));
    cursor = page.nextCursor;
  } while (cursor);
  return { ids, pages };
}

describe("GET /problems paging", () => {
  it("returns 50 by default, and every problem exactly once across pages, in learning order", async () => {
    const first = (await get("")).data;
    expect(first.items).toHaveLength(50);
    expect(first.total).toBe(catalog.items.length);
    expect(first.nextCursor).toEqual(expect.any(String));

    const { ids, pages } = await walk("limit=100");
    expect(ids).toEqual(catalog.items.map((i) => i.id));
    expect(pages.at(-1)!.nextCursor).toBeNull();
    // Totals and tags describe every match on every page.
    for (const p of pages) {
      expect(p.total).toBe(catalog.items.length);
      expect(p.tags).toEqual(first.tags);
    }
  });

  it("pages filtered results and curated lists in their own order", async () => {
    const sql = await walk("type=sql&limit=7");
    expect(sql.ids).toEqual(catalog.items.filter((i) => i.type === "sql").map((i) => i.id));
    expect(new Set(sql.ids).size).toBe(sql.ids.length);

    const list = catalog.lists[0]!;
    const listed = await walk(`list=${list.id}&limit=5`);
    expect(listed.ids).toEqual(list.items);
  });

  it("rejects a forged or out-of-date cursor", async () => {
    expect((await get("cursor=not-a-cursor")).status).toBe(400);
    expect((await get(`cursor=${encodeCursor({ after: "no-such-item" })}`)).status).toBe(400);
    expect((await get("limit=500")).status).toBe(400);
  });
});
