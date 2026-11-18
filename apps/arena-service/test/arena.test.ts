import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { UnauthorizedError, type AccessTokenVerifier } from "@logixai/service-kit";
import { buildApp } from "../src/app.js";
import { loadCatalog, type Catalog } from "../src/content/catalog.js";
import type { ArenaService, JudgeRequest } from "../src/services/arenaService.js";
import { createMemoryStore } from "../src/store/memoryStore.js";
import type { IdentityClient } from "../src/lib/identity.js";

const noInstitutions: IdentityClient = {
  getMembership: async () => null,
  myMemberships: async () => [],
  listBatches: async () => [],
  listBatchMembers: async () => [],
};

const CONTENT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "content");
// The real content, so these tests also prove it loads and its generated tests are current.
const catalog: Catalog = loadCatalog(CONTENT);

const verifier: AccessTokenVerifier = {
  async verify(token) {
    return { sub: token, role: "user", name: token, email: `${token}@x.com` };
  },
  async verifyHeader(header) {
    const token = String(header ?? "").replace(/^Bearer /, "");
    if (!token || token === "bad") throw new UnauthorizedError();
    return this.verify(token);
  },
};

let app: FastifyInstance;
let arena: ArenaService;
let judged: JudgeRequest[];
let clock: Date;

beforeEach(async () => {
  judged = [];
  clock = new Date("2026-11-18T06:00:00Z");
  const built = await buildApp({
    catalog,
    store: createMemoryStore(),
    judge: { submit: async (r) => void judged.push(r) },
    identity: noInstitutions,
    verifier,
    corsOrigins: [],
    now: () => clock,
  });
  app = built.app;
  arena = built.arena;
});

async function req(user: string | null, method: string, url: string, payload?: unknown) {
  const res = await app.inject({
    method: method as never,
    url: `/api/v1/arena${url}`,
    headers: user ? { authorization: `Bearer ${user}` } : {},
    payload: payload as never,
  });
  return { status: res.statusCode, data: res.json().data, body: res.json() };
}

const SUCCESS = (n: number) => Array.from({ length: n }, () => ({ status: "SUCCESS" as const, output: "1", timeMs: 5 }));

describe("catalog", () => {
  it("lists tracks, topics and items without signing in", async () => {
    const tracks = await req(null, "GET", "/tracks");
    expect(tracks.data.map((t: { id: string }) => t.id)).toEqual(["math-for-ml", "python-numpy", "ml-fundamentals"]);
    expect(tracks.data[0]).toMatchObject({ solvedCount: 0, mastery: 0 });

    const topic = await req(null, "GET", "/topics/vectors");
    expect(topic.data).toMatchObject({ trackId: "math-for-ml", nextTopic: { id: "matrices" }, previousTopic: null });
    expect(topic.data.lesson).toContain("dot product");
    expect(topic.data.items.length).toBeGreaterThan(2);

    expect((await req(null, "GET", "/topics/nope")).status).toBe(404);
  });

  it("never sends answers, solutions or hidden tests before an item is solved", async () => {
    const mcq = (await req("asha", "GET", "/items/vec-cosine-mcq")).data;
    expect(mcq.options).toHaveLength(4);
    expect(mcq).not.toHaveProperty("answer");
    expect(mcq).not.toHaveProperty("explanation");

    const code = (await req("asha", "GET", "/items/vec-dot-code")).data;
    expect(code.signature).toMatchObject({ name: "dot" });
    expect(code.samples[0]).toEqual({ call: "dot([1, 2, 3], [4, 5, 6])", expected: "32" });
    expect(code.hiddenTestCount).toBeGreaterThan(0);
    expect(code).not.toHaveProperty("solution");
    expect(JSON.stringify(code)).not.toContain("zip(a, b))");
  });

  it("every code item has built tests and a starter that differs from the solution", () => {
    const codeItems = catalog.items.filter((i) => i.type === "code" || i.type === "debug");
    expect(codeItems.length).toBeGreaterThan(10);
    for (const item of codeItems) expect(item.judge?.sample.length, item.id).toBeGreaterThan(0);
  });
});

describe("answering", () => {
  it("grades multiple choice, awards XP once, and reveals the explanation when correct", async () => {
    expect((await req(null, "POST", "/items/vec-cosine-mcq/answer", { selectedOptionIds: ["a"] })).status).toBe(401);

    const wrong = await req("asha", "POST", "/items/vec-cosine-mcq/answer", { selectedOptionIds: ["a"] });
    expect(wrong.data).toEqual({ correct: false, status: "attempted", xpGained: 0 });

    const right = await req("asha", "POST", "/items/vec-cosine-mcq/answer", { selectedOptionIds: ["b"] });
    expect(right.data).toMatchObject({ correct: true, status: "solved", xpGained: 10, answer: ["b"] });
    expect(right.data.explanation).toContain("orthogonal");

    const again = await req("asha", "POST", "/items/vec-cosine-mcq/answer", { selectedOptionIds: ["b"] });
    expect(again.data.xpGained).toBe(0);

    const view = (await req("asha", "GET", "/items/vec-cosine-mcq")).data;
    expect(view).toMatchObject({ status: "solved", answer: ["b"] });
  });

  it("checks numbers within the tolerance and all options of multi-select", async () => {
    expect((await req("asha", "POST", "/items/deriv-chain-numeric/answer", { value: 3.2974 })).data.correct).toBe(true);
    expect((await req("asha", "POST", "/items/deriv-chain-numeric/answer", { value: 3.31 })).data.correct).toBe(false);
    expect((await req("asha", "POST", "/items/mat-properties-multi/answer", { selectedOptionIds: ["b"] })).data.correct).toBe(false);
    expect((await req("asha", "POST", "/items/mat-properties-multi/answer", { selectedOptionIds: ["c", "b"] })).data.correct).toBe(true);
    // The wrong kind of answer is a 400, not a wrong answer.
    expect((await req("asha", "POST", "/items/deriv-chain-numeric/answer", { text: "3.3" })).status).toBe(400);
  });

  it("compares predicted output ignoring trailing whitespace", async () => {
    const res = await req("asha", "POST", "/items/np-mask-output/answer", { text: "[72, 90, 65]  \r\n2\n\n" });
    expect(res.data.correct).toBe(true);
  });

  it("gives no XP for solving after revealing", async () => {
    const revealed = (await req("asha", "POST", "/items/vec-dot-numeric/reveal")).data;
    expect(revealed).toMatchObject({ status: "revealed", answer: "-3" });
    const res = await req("asha", "POST", "/items/vec-dot-numeric/answer", { value: -3 });
    expect(res.data).toMatchObject({ correct: true, xpGained: 0 });
  });
});

describe("code items", () => {
  it("runs samples, submits all tests, and solves on a full pass", async () => {
    const item = catalog.item("vec-dot-code")!;
    const run = await req("asha", "POST", "/items/vec-dot-code/code", { code: "def dot(a, b): return 0", mode: "run" });
    expect(run.status).toBe(202);
    expect(run.data).toMatchObject({ status: "pending", total: item.judge!.sample.length });
    expect(judged[0]).toMatchObject({ userId: "asha", checker: { kind: "json", absTol: 1e-6, relTol: 1e-6 } });
    expect(judged[0]!.tests).toHaveLength(item.judge!.sample.length);
    expect(judged[0]!.program).toContain("solution.py");

    // One pending run at a time.
    const busy = await req("asha", "POST", "/items/vec-dot-code/code", { code: "x", mode: "run" });
    expect(busy.status).toBe(409);

    await arena.applyJudgeResult({
      submissionId: run.data.id,
      userId: "asha",
      response: [{ status: "WA", output: "0", timeMs: 4 }, ...SUCCESS(item.judge!.sample.length - 1)],
    });
    const ran = (await req("asha", "GET", `/submissions/${run.data.id}`)).data;
    expect(ran).toMatchObject({ status: "failed", passed: item.judge!.sample.length - 1 });
    expect(ran.tests[0]).toMatchObject({ verdict: "WA", call: "dot([1, 2, 3], [4, 5, 6])", expected: "32", output: "0" });

    const submit = await req("asha", "POST", "/items/vec-dot-code/code", { code: "def dot(a, b): ...", mode: "submit" });
    const total = item.judge!.sample.length + item.judge!.hidden.length;
    expect(judged[1]!.tests).toHaveLength(total);
    await arena.applyJudgeResult({ submissionId: submit.data.id, userId: "asha", response: SUCCESS(total) });
    const done = (await req("asha", "GET", `/submissions/${submit.data.id}`)).data;
    expect(done).toMatchObject({ status: "passed", passed: total, xpGained: 10 });

    const view = (await req("asha", "GET", "/items/vec-dot-code")).data;
    expect(view.status).toBe("solved");
    expect(view.solution).toContain("zip");
    expect(view.lastAnswer).toEqual({ code: "def dot(a, b): ..." });

    // Results are private.
    expect((await req("ravi", "GET", `/submissions/${submit.data.id}`)).status).toBe(404);
  });

  it("never echoes error text from hidden tests", async () => {
    const item = catalog.item("vec-dot-code")!;
    const n = item.judge!.sample.length;
    const total = n + item.judge!.hidden.length;
    const submit = await req("asha", "POST", "/items/vec-dot-code/code", { code: "x", mode: "submit" });
    await arena.applyJudgeResult({
      submissionId: submit.data.id,
      userId: "asha",
      response: [...SUCCESS(total - 1), { status: "RE", output: "ValueError: secret hidden input [1, 2]" }],
    });
    const result = (await req("asha", "GET", `/submissions/${submit.data.id}`)).data;
    expect(result.status).toBe("failed");
    expect(JSON.stringify(result)).not.toContain("secret");
    expect(result.tests[total - 1]).toEqual({ index: total - 1, sample: false, verdict: "RE" });
  });

  it("reports a compile-style failure that stopped every test", async () => {
    const run = await req("asha", "POST", "/items/vec-dot-code/code", { code: "def dot(:", mode: "run" });
    await arena.applyJudgeResult({
      submissionId: run.data.id,
      userId: "asha",
      response: [{ status: "ERROR", output: "The judge couldn't start your code." }],
    });
    expect((await req("asha", "GET", `/submissions/${run.data.id}`)).data.status).toBe("error");
  });

  it("rejects code for answer items and answers for code items", async () => {
    expect((await req("asha", "POST", "/items/vec-dot-numeric/code", { code: "x", mode: "run" })).status).toBe(400);
    expect((await req("asha", "POST", "/items/vec-dot-code/answer", { value: 1 })).status).toBe(400);
  });
});

describe("dashboard", () => {
  it("tracks XP, streaks, mastery and what to do next", async () => {
    await req("asha", "POST", "/items/vec-dot-numeric/answer", { value: -3 }); // day 1
    clock = new Date("2026-11-19T06:00:00Z");
    await req("asha", "POST", "/items/vec-l2-norm-numeric/answer", { value: 5 }); // wrong, still practice
    clock = new Date("2026-11-20T06:00:00Z");
    await req("asha", "POST", "/items/vec-l2-norm-numeric/answer", { value: 7 });

    const d = (await req("asha", "GET", "/me/dashboard")).data;
    expect(d).toMatchObject({ xp: 20, level: 1, solvedCount: 2, streak: { current: 3, longest: 3, activeToday: true } });
    expect(d.totalItems).toBe(catalog.items.length);
    expect(d.activity).toHaveLength(84);
    expect(d.activity.at(-1)).toEqual({ day: "2026-11-20", solved: 1 });
    expect(d.tracks[0].solvedCount).toBe(2);
    expect(d.weakestTopics[0]).toMatchObject({ id: "vectors" });
    expect(d.continueItem).toMatchObject({ id: "vec-cosine-mcq", topicTitle: "Vectors and the dot product" });
    expect(d.dailyItem).toHaveProperty("difficulty");

    // A missed day breaks the current streak but not the longest.
    clock = new Date("2026-11-23T06:00:00Z");
    const later = (await req("asha", "GET", "/me/dashboard")).data;
    expect(later.streak).toEqual({ current: 0, longest: 3, activeToday: false });

    expect((await req(null, "GET", "/me/dashboard")).status).toBe(401);
    expect((await req("bad", "GET", "/tracks")).status).toBe(401);
  });
});
