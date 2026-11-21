import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { UnauthorizedError, type AccessTokenVerifier } from "@logixai/service-kit";
import { buildApp } from "../src/app.js";
import {
  CODE_PLACEHOLDER,
  applyBrowserRunRecord,
  browserCandidate,
  browserRunHash,
  readBrowserRunRecord,
  runIn,
} from "../src/content/browserRun.js";
import { loadCatalog, type Catalog } from "../src/content/catalog.js";
import { createMemoryStore } from "../src/store/memoryStore.js";

/* Run in the browser: which items, the runner kit, and access rules. */

const CONTENT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "content");
let catalog: Catalog;
let app: FastifyInstance;

const verifier: AccessTokenVerifier = {
  async verify(token) {
    const pro = token.startsWith("pro");
    return { sub: token, role: "user", name: token, email: `${token}@x.com`, plan: pro ? "pro" : "free", planUntil: pro ? 32_503_680_000 : null };
  },
  async verifyHeader(header) {
    const token = String(header ?? "").replace(/^Bearer /, "");
    if (!token) throw new UnauthorizedError();
    return this.verify(token);
  },
};

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

const get = (url: string, user?: string) =>
  app.inject({ method: "GET", url: `/api/v1/arena${url}`, headers: user ? { authorization: `Bearer ${user}` } : {} });
const item = (id: string) => catalog.item(id)!;

describe("which items run in the browser", () => {
  it("keeps PyTorch, JavaScript and dataset items on the judge", () => {
    for (const i of catalog.items) {
      if (!("judge" in i) || !i.judge) continue;
      if (i.type !== "sql" && "language" in i && i.language === "javascript") expect(browserCandidate(i)).toBe(false);
      if ("dataset" in i && i.dataset) expect(runIn(i)).toBe("server");
    }
  });

  it("runs only items verified against the judge, and an edit sends one back to the server", () => {
    const sql = item("sql-running-total");
    expect(runIn(sql)).toBe("browser");
    // A candidate that differs in 32-bit WebAssembly (np.bincount) isn't verified.
    expect(browserCandidate(item("np-class-counts"))).toBe(true);
    expect(runIn(item("np-class-counts"))).toBe("server");

    const record = readBrowserRunRecord(CONTENT);
    expect(record.items["sql-running-total"]).toBe(browserRunHash(sql));
    const edited = { ...sql, solution: `${"solution" in sql ? sql.solution : ""}\n-- edited` } as typeof sql;
    applyBrowserRunRecord([edited], record);
    expect(runIn(edited)).toBe("server");
  });
});

describe("GET /items/:id/runner", () => {
  it("gives the judge program with one placeholder, the sample tests and the tolerance, signed out", async () => {
    const res = await get("/items/m1s10-two-proportion/runner");
    expect(res.statusCode).toBe(200);
    const kit = res.json().data;
    expect(kit).toMatchObject({ itemId: "m1s10-two-proportion", engine: "pyodide", codeLanguage: "python", placeholder: CODE_PLACEHOLDER });
    expect(kit.program.split(CODE_PLACEHOLDER)).toHaveLength(2);
    expect(kit.tests).toHaveLength(item("m1s10-two-proportion").judge!.sample.length);
    expect(kit.tests[0]).toMatchObject({ call: "ab_test(200, 5000, 250, 5000)" });
    // Hidden tests never leave the server.
    expect(JSON.stringify(kit)).not.toContain(JSON.stringify(item("m1s10-two-proportion").judge!.hidden[0]!.args));

    const view = (await get("/items/m1s10-two-proportion")).json().data;
    expect(view.runIn).toBe("browser");
  });

  it("marks SQL kits and 404s items that run on the judge", async () => {
    expect((await get("/items/sql-running-total/runner")).json().data.codeLanguage).toBe("sql");
    expect((await get("/items/np-class-counts/runner")).statusCode).toBe(404);
    expect((await get("/items/np-class-counts")).json().data.runIn).toBe("server");
    expect((await get("/items/m1s6-data-types/runner")).statusCode).toBe(404);
  });

  it("keeps Pro items locked", async () => {
    expect((await get("/items/grad-numerical-gradient-code/runner")).statusCode).toBe(403);
    expect((await get("/items/grad-numerical-gradient-code/runner", "free-user")).statusCode).toBe(403);
    expect((await get("/items/grad-numerical-gradient-code/runner", "pro-user")).statusCode).toBe(200);
  });
});
