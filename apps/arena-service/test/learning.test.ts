import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { UnauthorizedError, type AccessTokenVerifier } from "@logixai/service-kit";
import { buildApp } from "../src/app.js";
import { loadCatalog } from "../src/content/catalog.js";
import type { IdentityClient } from "../src/lib/identity.js";
import type { ArenaService, JudgeRequest } from "../src/services/arenaService.js";
import { nextReview } from "../src/services/learning.js";
import { createMemoryStore } from "../src/store/memoryStore.js";

const CONTENT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "content");
const catalog = loadCatalog(CONTENT);

const verifier: AccessTokenVerifier = {
  async verify(token) {
    return { sub: token, role: "user", name: token, email: `${token}@x.com` };
  },
  async verifyHeader(header) {
    const token = String(header ?? "").replace(/^Bearer /, "");
    if (!token) throw new UnauthorizedError();
    return this.verify(token);
  },
};

/** One institution "inst" with batches "cse" and "ece"; tokens are "Bearer <userId>". */
const PEOPLE: Record<string, { role: "owner" | "instructor" | "student"; batchIds: string[] }> = {
  teacher: { role: "instructor", batchIds: [] },
  asha: { role: "student", batchIds: ["cse"] },
  ravi: { role: "student", batchIds: ["cse"] },
  meera: { role: "student", batchIds: ["ece"] },
};
const who = (auth: string) => auth.replace(/^Bearer /, "");
const identity: IdentityClient = {
  async getMembership(auth, institutionId) {
    return institutionId === "inst" ? (PEOPLE[who(auth)] ?? null) : null;
  },
  async myMemberships(auth) {
    const p = PEOPLE[who(auth)];
    return p
      ? [{ institution: { id: "inst", name: "Delhi Public School", slug: "dps", type: "school", createdAt: "" }, role: p.role, batchIds: p.batchIds, joinedAt: "" }]
      : [];
  },
  async listBatches() {
    return [
      { id: "cse", name: "CSE 2026" },
      { id: "ece", name: "ECE 2026" },
    ];
  },
  async listBatchMembers(_auth, _inst, batchId) {
    return Object.entries(PEOPLE)
      .filter(([, p]) => p.batchIds.includes(batchId))
      .map(([userId, p]) => ({ userId, name: userId, email: `${userId}@x.com`, role: p.role, batchIds: p.batchIds, joinedAt: "" }));
  },
};

let app: FastifyInstance;
let arena: ArenaService;
let judged: JudgeRequest[];
let clock: Date;
const DAY = 24 * 60 * 60 * 1000;
const later = (days: number) => (clock = new Date(clock.getTime() + days * DAY));

beforeEach(async () => {
  judged = [];
  clock = new Date("2026-11-18T06:00:00Z");
  const built = await buildApp({
    catalog,
    store: createMemoryStore(),
    judge: { submit: async (r) => void judged.push(r) },
    identity,
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
  return { status: res.statusCode, data: res.json().data };
}

describe("review intervals", () => {
  it("grows on success and starts over on a miss", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const after = (r: { intervalDays: number }, ok: boolean) => nextReview({ due: now, intervalDays: r.intervalDays }, ok, now);
    expect(after({ intervalDays: 1 }, true).intervalDays).toBe(3);
    expect(after({ intervalDays: 35 }, true).intervalDays).toBe(90);
    expect(after({ intervalDays: 90 }, true).intervalDays).toBe(90);
    expect(after({ intervalDays: 16 }, false).intervalDays).toBe(1);
    expect(after({ intervalDays: 3 }, true).due.toISOString()).toBe("2026-01-08T00:00:00.000Z");
  });
});

describe("spaced repetition", () => {
  it("schedules a review after solving and spaces it out on success", async () => {
    await req("asha", "POST", "/items/vec-dot-numeric/answer", { value: -3 });
    let view = (await req("asha", "GET", "/items/vec-dot-numeric")).data;
    expect(view.review).toMatchObject({ intervalDays: 1, isDue: false });
    expect((await req("asha", "GET", "/me/review")).data).toMatchObject({ due: [], upcomingCount: 1 });

    later(1);
    const queue = (await req("asha", "GET", "/me/review")).data;
    expect(queue.due.map((e: { id: string }) => e.id)).toEqual(["vec-dot-numeric"]);
    expect((await req("asha", "GET", "/me/dashboard")).data.reviewDueCount).toBe(1);

    const recall = await req("asha", "POST", "/items/vec-dot-numeric/answer", { value: -3 });
    expect(recall.data).toMatchObject({ correct: true, reviewed: true, xpGained: 0 });
    view = (await req("asha", "GET", "/items/vec-dot-numeric")).data;
    expect(view.review).toMatchObject({ intervalDays: 3, isDue: false });

    // Answering again before it's due isn't a review.
    expect((await req("asha", "POST", "/items/vec-dot-numeric/answer", { value: -3 })).data.reviewed).toBeUndefined();

    // A miss when due starts over.
    later(3);
    const miss = await req("asha", "POST", "/items/vec-dot-numeric/answer", { value: 3 });
    expect(miss.data).toMatchObject({ correct: false, reviewed: true, status: "solved" });
    expect((await req("asha", "GET", "/items/vec-dot-numeric")).data.review.intervalDays).toBe(1);
  });

  it("counts a passing submit on a due code item as its review", async () => {
    const item = catalog.item("vec-dot-code")!;
    const total = item.judge!.sample.length + item.judge!.hidden.length;
    const pass = () => Array.from({ length: total }, () => ({ status: "SUCCESS" as const, output: "1" }));
    const first = await req("asha", "POST", "/items/vec-dot-code/code", { code: "x", mode: "submit" });
    await arena.applyJudgeResult({ submissionId: first.data.id, userId: "asha", response: pass() });
    later(1);
    const again = await req("asha", "POST", "/items/vec-dot-code/code", { code: "x", mode: "submit" });
    await arena.applyJudgeResult({ submissionId: again.data.id, userId: "asha", response: pass() });
    expect((await req("asha", "GET", "/items/vec-dot-code")).data.review.intervalDays).toBe(3);
  });

  it("lists attempted-but-unsolved items to retry", async () => {
    await req("asha", "POST", "/items/vec-l2-norm-numeric/answer", { value: 5 });
    expect((await req("asha", "GET", "/me/review")).data.retry.map((e: { id: string }) => e.id)).toEqual(["vec-l2-norm-numeric"]);
  });
});

describe("skill map and recommendations", () => {
  it("maps topics and prerequisites, signed out too", async () => {
    const map = (await req(null, "GET", "/skill-map")).data;
    expect(map.topics.find((t: { id: string }) => t.id === "vectors")).toMatchObject({ depth: 0, mastery: 0, started: false });
    expect(map.topics.find((t: { id: string }) => t.id === "logistic-regression").depth).toBeGreaterThan(2);
    expect(map.edges).toContainEqual({ from: "derivatives", to: "logistic-regression" });
  });

  it("spots a struggling topic and points at its weak prerequisites", async () => {
    for (let i = 0; i < 4; i++) {
      await req("asha", "POST", "/items/logreg-boundary-mcq/answer", { selectedOptionIds: ["a"] });
    }
    const map = (await req("asha", "GET", "/skill-map")).data;
    const node = map.topics.find((t: { id: string }) => t.id === "logistic-regression");
    expect(node.struggling).toBe(true);
    expect(node.rootCauses.map((c: { id: string }) => c.id)).toEqual(
      expect.arrayContaining(["linear-regression", "derivatives", "classification-metrics"]),
    );

    const recs = (await req("asha", "GET", "/me/dashboard")).data.recommendations;
    expect(recs.some((r: { kind: string }) => r.kind === "strengthen")).toBe(true);
    expect(recs.find((r: { kind: string }) => r.kind === "continue").item.id).toBe("logreg-boundary-mcq");
    expect(recs.length).toBeLessThanOrEqual(6);
    expect(new Set(recs.map((r: { item: { id: string } }) => r.item.id)).size).toBe(recs.length);
  });

  it("puts due reviews first", async () => {
    await req("asha", "POST", "/items/vec-dot-numeric/answer", { value: -3 });
    later(2);
    const recs = (await req("asha", "GET", "/me/dashboard")).data.recommendations;
    expect(recs[0]).toMatchObject({ kind: "review", item: { id: "vec-dot-numeric" } });
  });
});

describe("dataset challenges", () => {
  it("shows a preview and the pass mark, never the labels", async () => {
    const view = (await req("asha", "GET", "/items/mc-loans-challenge")).data;
    expect(view.scoring).toEqual({ metric: "f1", threshold: 0.55 });
    expect(view.dataset).toMatchObject({ target: "default", rowCount: 900 });
    expect(view.dataset.rows.length).toBeGreaterThan(0);
    expect(view.samples[0].call).toMatch(/^train_and_predict\(<DataFrame: \d+ rows × 8 columns>, <DataFrame: \d+ rows × 7 columns>\)$/);
    expect(view.samples[0].expected).toBe("f1 ≥ 0.55");

    const run = await req("asha", "POST", "/items/mc-loans-challenge/code", { code: "def train_and_predict(train, test): ...", mode: "submit" });
    const job = judged[0]!;
    expect(job.checker).toEqual({ kind: "metric", metric: "f1", threshold: 0.55 });
    expect(job.tests).toHaveLength(2);
    // Test-row features go into the sandbox; their labels only reach the evaluator's checker.
    expect(JSON.parse(job.tests[1]!.input).args[1].columns).not.toContain("default");

    await arena.applyJudgeResult({
      submissionId: run.data.id,
      userId: "asha",
      response: [
        { status: "SUCCESS", output: "f1 0.6100", timeMs: 900 },
        { status: "WA", output: "f1 0.5100", timeMs: 900 },
      ],
    });
    const result = (await req("asha", "GET", `/submissions/${run.data.id}`)).data;
    expect(result.tests[0]).toMatchObject({ expected: "f1 ≥ 0.55", output: "f1 0.6100" });
    expect(result.tests[1]).toEqual({ index: 1, sample: false, verdict: "WA", timeMs: 900 });
  });
});

describe("institutions", () => {
  it("lets instructors assign tracks to batches and students see them", async () => {
    const body = { batchId: "cse", trackId: "math-for-ml", dueAt: "2026-12-01T00:00:00.000Z" };
    expect((await req("asha", "POST", "/institutions/inst/assignments", body)).status).toBe(403);
    expect((await req("stranger", "POST", "/institutions/inst/assignments", body)).status).toBe(404);
    const created = await req("teacher", "POST", "/institutions/inst/assignments", body);
    expect(created.status).toBe(201);
    expect(created.data).toMatchObject({ trackTitle: "Math for machine learning", batchId: "cse" });
    expect((await req("teacher", "POST", "/institutions/inst/assignments", body)).status).toBe(409);
    expect((await req("teacher", "POST", "/institutions/inst/assignments", { ...body, batchId: "nope" })).status).toBe(400);
    expect((await req("teacher", "POST", "/institutions/inst/assignments", { ...body, trackId: "nope" })).status).toBe(400);

    await req("asha", "POST", "/items/vec-dot-numeric/answer", { value: -3 });
    const mine = (await req("asha", "GET", "/me/assignments")).data;
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ institutionName: "Delhi Public School", trackId: "math-for-ml", solvedCount: 1 });
    expect((await req("meera", "GET", "/me/assignments")).data).toEqual([]);
    expect((await req("meera", "GET", "/institutions/inst/assignments")).data).toEqual([]);
    expect((await req("teacher", "GET", "/institutions/inst/assignments")).data).toHaveLength(1);

    expect((await req("teacher", "GET", "/institutions/inst/audit")).status).toBe(403); // admins only

    expect((await req("teacher", "DELETE", `/institutions/inst/assignments/${created.data.id}`)).status).toBe(200);
    expect((await req("asha", "GET", "/me/assignments")).data).toEqual([]);
  });

  it("reports a batch's progress per student and per topic", async () => {
    await req("asha", "POST", "/items/vec-dot-numeric/answer", { value: -3 });
    await req("asha", "POST", "/items/vec-l2-norm-numeric/answer", { value: 7 });
    await req("ravi", "POST", "/items/mat-shape-mcq/answer", { selectedOptionIds: ["b"] });
    expect((await req("asha", "GET", "/institutions/inst/report?batchId=cse&trackId=math-for-ml")).status).toBe(403);

    const report = (await req("teacher", "GET", "/institutions/inst/report?batchId=cse&trackId=math-for-ml")).data;
    expect(report.topics.map((t: { id: string }) => t.id)).toEqual(["vectors", "matrices", "derivatives", "gradients", "probability-basics"]);
    expect(report.rows.map((r: { name: string }) => r.name)).toEqual(["asha", "ravi"]);
    expect(report.rows[0]).toMatchObject({ solvedCount: 2, xp: 20 });
    expect(report.rows[1].topicMastery[1]).toBeGreaterThan(0);
    expect(report.topicAverages[0]).toBeCloseTo(report.rows[0].topicMastery[0] / 2, 1);
    expect(report.rows[0].lastActiveAt).toBe(clock.toISOString());
  });
});
