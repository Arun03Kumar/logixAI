import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { UnauthorizedError, type AccessTokenVerifier } from "@logixai/service-kit";
import { buildApp } from "../src/app.js";
import { loadCatalog, type Catalog } from "../src/content/catalog.js";
import type { ArenaService, JudgeRequest } from "../src/services/arenaService.js";
import { createMemoryStore } from "../src/store/memoryStore.js";

/* Judge at scale: priorities, backpressure on Run, results pushed on a stream. */

const CONTENT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "content");
const ITEM = "m1s10-two-proportion";
const CODE = "def ab_test(conv_a, n_a, conv_b, n_b):\n    return [0, 0]\n";

const verifier: AccessTokenVerifier = {
  async verify(token) {
    return { sub: token, role: "user", name: token, email: `${token}@x.com`, plan: "pro", planUntil: 32_503_680_000 };
  },
  async verifyHeader(header) {
    const token = String(header ?? "").replace(/^Bearer /, "");
    if (!token) throw new UnauthorizedError();
    return this.verify(token);
  },
};

let catalog: Catalog;
let app: FastifyInstance;
let arena: ArenaService;
let backlog = { waiting: 0, headWaitMs: 0 };
const sent: JudgeRequest[] = [];

beforeAll(async () => {
  catalog = loadCatalog(CONTENT);
  ({ app, arena } = await buildApp({
    catalog,
    store: createMemoryStore(),
    judge: {
      submit: async (r) => {
        sent.push(r);
      },
      backlog: async () => backlog,
    },
    identity: { getMembership: async () => null, myMemberships: async () => [], listBatches: async () => [], listBatchMembers: async () => [] },
    verifier,
    corsOrigins: [],
    busyBacklog: 500,
    busyWaitMs: 30_000,
    streamTimeoutMs: 300,
  }));
});

const api = (user: string, method: "GET" | "POST", url: string, payload?: unknown) =>
  app.inject({ method, url: `/api/v1/arena${url}`, headers: { authorization: `Bearer ${user}` }, ...(payload ? { payload: payload as never } : {}) });

/** Answers a pending submission as the judge would. */
const judge = (submissionId: string, userId: string, pass: boolean) =>
  arena.applyJudgeResult({
    submissionId,
    userId,
    response: [{ status: pass ? "SUCCESS" : "WA", output: pass ? catalog.item(ITEM)!.judge!.sample[0]!.expected : "[0, 0]" }],
  });

describe("judge queue", () => {
  it("tags Run and Submit so the queue can judge Submits first", async () => {
    const run = await api("prio", "POST", `/items/${ITEM}/code`, { code: CODE, mode: "run" });
    expect(run.statusCode).toBe(202);
    await judge(run.json().data.id, "prio", false);
    await api("prio", "POST", `/items/${ITEM}/code`, { code: CODE, mode: "submit" });
    expect(sent.slice(-2).map((r) => r.mode)).toEqual(["run", "submit"]);
  });

  it("refuses a Run quickly when the judge is far behind, but still accepts a Submit", async () => {
    backlog = { waiting: 501, headWaitMs: 0 };
    const run = await api("busy", "POST", `/items/${ITEM}/code`, { code: CODE, mode: "run" });
    expect(run.statusCode).toBe(429);
    expect(run.json().message).toMatch(/busy/);
    const submit = await api("busy", "POST", `/items/${ITEM}/code`, { code: CODE, mode: "submit" });
    expect(submit.statusCode).toBe(202);
    backlog = { waiting: 0, headWaitMs: 0 };
  });

  it("also says busy when few jobs wait but the queue is slow (the next job has waited too long)", async () => {
    backlog = { waiting: 12, headWaitMs: 45_000 };
    expect((await api("slow", "POST", `/items/${ITEM}/code`, { code: CODE, mode: "run" })).statusCode).toBe(429);
    backlog = { waiting: 12, headWaitMs: 5_000 };
    expect((await api("slow", "POST", `/items/${ITEM}/code`, { code: CODE, mode: "run" })).statusCode).toBe(202);
    backlog = { waiting: 0, headWaitMs: 0 };
  });
});

describe("result stream", () => {
  it("pushes the result the moment it's judged", async () => {
    const created = (await api("s1", "POST", `/items/${ITEM}/code`, { code: CODE, mode: "run" })).json().data;
    const stream = api("s1", "GET", `/submissions/${created.id}/stream`);
    setTimeout(() => void judge(created.id, "s1", true), 50);
    const res = await stream;
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/event-stream");
    const data = /event: result\ndata: (.*)\n\n/.exec(res.body)?.[1];
    expect(JSON.parse(data!)).toMatchObject({ id: created.id, status: "passed", passed: 1 });
  });

  it("answers at once when already judged, times out to polling otherwise, and hides other people's", async () => {
    const created = (await api("s2", "POST", `/items/${ITEM}/code`, { code: CODE, mode: "run" })).json().data;
    const pending = await api("s2", "GET", `/submissions/${created.id}/stream`);
    expect(pending.body).toContain("event: timeout");

    await judge(created.id, "s2", false);
    const done = await api("s2", "GET", `/submissions/${created.id}/stream`);
    expect(done.body).toMatch(/event: result\ndata: .*"status":"failed"/);

    expect((await api("someone-else", "GET", `/submissions/${created.id}/stream`)).statusCode).toBe(404);
  });
});
