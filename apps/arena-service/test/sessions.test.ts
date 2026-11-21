import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { UnauthorizedError, type AccessTokenVerifier } from "@logixai/service-kit";
import { buildApp } from "../src/app.js";
import { loadCatalog, type Catalog } from "../src/content/catalog.js";
import type { ArenaService, JudgeRequest } from "../src/services/arenaService.js";
import { FREE_MOCKS_PER_WEEK, shortName } from "../src/services/practiceService.js";
import { createMemoryStore } from "../src/store/memoryStore.js";

/* P6: mock interviews, weekly contests and public profiles. */

const CONTENT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "content");
const catalog: Catalog = loadCatalog(CONTENT);

// Tokens look like "pro-asha" or "ravi"; the name is "<Token> Kumar".
const verifier: AccessTokenVerifier = {
  async verify(token) {
    const pro = token.startsWith("pro-");
    const name = `${token.replace(/^pro-/, "").replace(/^./, (c) => c.toUpperCase())} Kumar`;
    return { sub: token, role: "user", name, email: `${token}@x.com`, plan: pro ? "pro" : "free", planUntil: pro ? 4_102_444_800 : null };
  },
  async verifyHeader(header) {
    const token = String(header ?? "").replace(/^Bearer /, "");
    if (!token) throw new UnauthorizedError();
    return this.verify(token);
  },
};

let app: FastifyInstance;
let arena: ArenaService;
let judged: JudgeRequest[];
let clock: Date;

beforeEach(async () => {
  judged = [];
  clock = new Date("2026-11-20T06:00:00Z");
  const built = await buildApp({
    catalog,
    store: createMemoryStore(),
    judge: { submit: async (r) => void judged.push(r) },
    identity: { getMembership: async () => null, myMemberships: async () => [], listBatches: async () => [], listBatchMembers: async () => [] },
    verifier,
    corsOrigins: [],
    codeRunsPerMinute: 1000,
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
  return { status: res.statusCode, data: res.json().data, message: res.json().message as string };
}

const minutesLater = (m: number) => {
  clock = new Date(clock.getTime() + m * 60_000);
};

/** Answers an mcq/numeric/output item correctly or not. */
async function answer(user: string, itemId: string, right: boolean) {
  const item = catalog.item(itemId)!;
  const body =
    item.type === "numeric"
      ? { value: right ? item.answer : item.answer + 1000 }
      : item.type === "output"
        ? { text: right ? item.answer : "nope" }
        : item.type === "mcq_single"
          ? { selectedOptionIds: [right ? item.answer : item.options.find((o) => o.id !== item.answer)!.id] }
          : item.type === "mcq_multi"
            ? { selectedOptionIds: right ? item.answer : ["zz"] }
            : null;
  return req(user, "POST", `/items/${itemId}/answer`, body);
}

/** Submits code and has the judge pass or fail every test. */
async function submit(user: string, itemId: string, pass: boolean) {
  const run = await req(user, "POST", `/items/${itemId}/code`, { code: "x", mode: "submit" });
  expect(run.status).toBe(202);
  const item = catalog.item(itemId)!;
  const total = item.judge!.sample.length + item.judge!.hidden.length;
  await arena.applyJudgeResult({
    submissionId: run.data.id,
    userId: user,
    response: Array.from({ length: total }, () => ({ status: pass ? ("SUCCESS" as const) : ("WA" as const), output: "{}", timeMs: 5 })),
  });
}

describe("mock interviews", () => {
  it("lists templates and starts a timed session from free, preferably unsolved items", async () => {
    const hub = (await req("asha", "GET", "/mocks")).data;
    expect(hub.templates.map((t: { id: string }) => t.id)).toContain("data-scientist-screen");
    const ds = hub.templates.find((t: { id: string }) => t.id === "data-scientist-screen");
    expect(ds).toMatchObject({ durationMin: 45, questionCount: 5, outline: ["2 SQL", "1 Pandas", "2 Concepts"] });
    expect(hub.remainingThisWeek).toBe(FREE_MOCKS_PER_WEEK);

    const started = await req("asha", "POST", "/mocks", { templateId: "data-scientist-screen" });
    expect(started.status).toBe(201);
    const s = started.data;
    expect(s.items).toHaveLength(5);
    expect(new Set(s.items.map((i: { id: string }) => i.id)).size).toBe(5);
    expect(s.items.every((i: { id: string }) => catalog.item(i.id)!.access === "free")).toBe(true);
    expect(s.items.slice(0, 2).every((i: { type: string }) => i.type === "sql")).toBe(true);
    expect(new Date(s.endsAt).getTime() - new Date(s.startedAt).getTime()).toBe(45 * 60_000);
    expect(s.over).toBe(false);
    expect(s).not.toHaveProperty("report");

    // One session at a time.
    const second = await req("asha", "POST", "/mocks", { templateId: "sql-sprint" });
    expect(second.status).toBe(409);
    expect((await req("asha", "GET", "/mocks")).data.active.id).toBe(s.id);
  });

  it("records answers and submits made during the session, hides solutions, then reports", async () => {
    const s = (await req("asha", "POST", "/mocks", { templateId: "data-scientist-screen" })).data;
    const [sql1, sql2, pandas, quiz1, quiz2] = s.items.map((i: { id: string }) => i.id);

    minutesLater(3);
    await submit("asha", sql1, false);
    minutesLater(4);
    await submit("asha", sql1, true);
    await answer("asha", quiz1, true);
    await answer("asha", quiz2, false);
    // Solutions stay hidden while the session runs.
    const reveal = await req("asha", "POST", `/items/${pandas}/reveal`);
    expect(reveal.status).toBe(409);

    let view = (await req("asha", "GET", `/sessions/${s.id}`)).data;
    const byId = Object.fromEntries(view.items.map((i: { id: string }) => [i.id, i]));
    expect(byId[sql1]).toMatchObject({ solved: true, solvedAfterMin: 7, wrongAttempts: 1 });
    expect(byId[quiz1]).toMatchObject({ solved: true });
    expect(byId[quiz2]).toMatchObject({ solved: false, wrongAttempts: 1 });
    expect(byId[sql2]).toMatchObject({ solved: false, wrongAttempts: 0 });

    view = (await req("asha", "POST", `/sessions/${s.id}/finish`)).data;
    expect(view.over).toBe(true);
    expect(view.report.solved).toBe(2);
    expect(view.report.total).toBe(5);
    expect(["strong", "borderline", "needs-work"]).toContain(view.report.verdict);
    expect(view.report.practiceNext.length).toBeGreaterThan(0);

    // After it ends, answers no longer change it, and solutions can be revealed.
    await submit("asha", sql2, true);
    const after = (await req("asha", "GET", `/sessions/${s.id}`)).data;
    expect(after.items.find((i: { id: string }) => i.id === sql2).solved).toBe(false);
    expect((await req("asha", "POST", `/items/${pandas}/reveal`)).status).toBe(200);
    // Another learner can't read it.
    expect((await req("ravi", "GET", `/sessions/${s.id}`)).status).toBe(404);
  });

  it("time running out ends the session; free learners get a weekly allowance", async () => {
    const s = (await req("asha", "POST", "/mocks", { templateId: "sql-sprint" })).data;
    minutesLater(31);
    const late = (await req("asha", "GET", `/sessions/${s.id}`)).data;
    expect(late.over).toBe(true);
    expect(late.report).toBeDefined();
    await answer("asha", s.items[0].id, true); // too late to count (and sql items don't take answers)

    for (let i = 1; i < FREE_MOCKS_PER_WEEK; i++) {
      const next = (await req("asha", "POST", "/mocks", { templateId: "sql-sprint" })).data;
      await req("asha", "POST", `/sessions/${next.id}/finish`);
    }
    const blocked = await req("asha", "POST", "/mocks", { templateId: "sql-sprint" });
    expect(blocked.status).toBe(403);
    expect((await req("asha", "GET", "/mocks")).data.remainingThisWeek).toBe(0);
    // Pro has no limit.
    expect((await req("pro-meera", "GET", "/mocks")).data.remainingThisWeek).toBeNull();
    // A week later it resets.
    minutesLater(7 * 24 * 60);
    expect((await req("asha", "POST", "/mocks", { templateId: "sql-sprint" })).status).toBe(201);
  });
});

describe("weekly contests", () => {
  // Contest #3 runs 2026-11-15 10:00–11:30 India time (04:30–06:00 UTC).
  const LIVE = new Date("2026-11-15T04:40:00Z");

  it("schedules contests automatically and hides questions until the start", async () => {
    clock = new Date("2026-11-15T04:00:00Z");
    const list = (await req(null, "GET", "/contests")).data;
    // Newest first: the next contest, then the ones before it.
    expect(list[0]).toMatchObject({ id: "weekly-3", status: "upcoming", startsAt: "2026-11-15T04:30:00.000Z" });
    expect(list.slice(1).map((c: { id: string }) => c.id)).toEqual(["weekly-2", "weekly-1"]);
    expect(list.slice(1).every((c: { status: string }) => c.status === "ended")).toBe(true);
    const upcoming = (await req(null, "GET", "/contests/weekly-3")).data;
    expect(upcoming.items).toBeNull();
    expect((await req("asha", "POST", "/contests/weekly-3/join")).status).toBe(409);
    expect((await req(null, "GET", "/contests/weekly-99x")).status).toBe(404);

    clock = LIVE;
    const live = (await req(null, "GET", "/contests/weekly-3")).data;
    expect(live.status).toBe("live");
    expect(live.items).toHaveLength(4);
    // Same contest, same questions.
    expect((await req(null, "GET", "/contests/weekly-3")).data.items).toEqual(live.items);
    expect((await req(null, "GET", "/contests/weekly-2")).data.items).not.toEqual(live.items);
  });

  it("ranks by points, then penalty, and unlocks Pro questions for the contest", async () => {
    clock = LIVE;
    const contest = (await req(null, "GET", "/contests/weekly-3")).data;
    const [a, b] = contest.items.map((i: { id: string }) => i.id);

    const joined = (await req("asha", "POST", "/contests/weekly-3/join")).data;
    expect(joined).toMatchObject({ kind: "contest", ranked: true, endsAt: "2026-11-15T06:00:00.000Z" });
    expect((await req("asha", "POST", "/contests/weekly-3/join")).data.id).toBe(joined.id); // idempotent
    await req("ravi", "POST", "/contests/weekly-3/join");
    await req("meera", "POST", "/contests/weekly-3/join");

    // Every contest question is open to free learners while they're in it.
    for (const item of contest.items) {
      const view = (await req("asha", "GET", `/items/${item.id}`)).data;
      expect(view.locked).toBeFalsy();
    }

    // Asha: a at +10 min after one failed submit. Ravi: a at +20, b at +30. Meera: a at +10, clean.
    minutesLater(0);
    await submit("asha", a, false);
    await submit("meera", a, true);
    await submit("asha", a, true);
    minutesLater(10);
    await submit("ravi", a, true);
    minutesLater(10);
    await submit("ravi", b, true);

    const board = (await req("asha", "GET", "/contests/weekly-3")).data;
    const pointsA = { easy: 3, medium: 4, hard: 5, expert: 6 }[catalog.item(a)!.difficulty as "easy"];
    expect(board.leaderboard.map((r: { name: string }) => r.name)).toEqual(["Ravi K.", "Meera K.", "Asha K."]);
    expect(board.leaderboard[1]).toMatchObject({ points: pointsA, penaltyMin: 10, rank: 2 });
    expect(board.leaderboard[2]).toMatchObject({ points: pointsA, penaltyMin: 15, rank: 3, me: true });
    expect(board.myRow).toMatchObject({ rank: 3, name: "Asha K." });
    expect(board.participants).toBe(3);

    // A public profile shows its handle on the leaderboard.
    await req("meera", "POST", "/me/profile", { handle: "meera_ml", displayName: "Meera", bio: "", public: true });
    const withHandle = (await req(null, "GET", "/contests/weekly-3")).data;
    expect(withHandle.leaderboard[1]).toMatchObject({ name: "Meera", handle: "meera_ml" });
  });

  it("after the contest: virtual, unranked participation", async () => {
    clock = new Date("2026-11-18T10:00:00Z");
    const s = (await req("asha", "POST", "/contests/weekly-3/join")).data;
    expect(s).toMatchObject({ ranked: false, title: "Weekly Arena #3 (virtual)" });
    expect(new Date(s.endsAt).getTime() - clock.getTime()).toBe(90 * 60_000);
    await submit("asha", s.items[0].id, true);
    const view = (await req("asha", "GET", "/contests/weekly-3")).data;
    expect(view.leaderboard).toHaveLength(0);
    expect(view.mySession.id).toBe(s.id);
  });
});

describe("profiles", () => {
  it("suggests settings, saves them, and serves public profiles only", async () => {
    const mine = (await req("asha", "GET", "/me/profile")).data;
    expect(mine).toMatchObject({ handle: "asha_kumar", displayName: "Asha K.", public: false, saved: false });

    expect((await req("asha", "POST", "/me/profile", { handle: "Admin", displayName: "A", bio: "", public: true })).status).toBe(400);
    expect((await req("asha", "POST", "/me/profile", { handle: "a!", displayName: "A", bio: "", public: true })).status).toBe(400);

    const saved = (await req("asha", "POST", "/me/profile", { handle: "Asha_ML", displayName: "Asha", bio: "SQL fan", public: false })).data;
    expect(saved).toMatchObject({ handle: "asha_ml", saved: true, url: "/u/asha_ml" });
    expect((await req(null, "GET", "/profiles/asha_ml")).status).toBe(404);

    expect((await req("ravi", "POST", "/me/profile", { handle: "asha_ml", displayName: "R", bio: "", public: true })).status).toBe(409);

    await answer("asha", "sql-null-not-equal-mcq", true);
    await req("asha", "POST", "/me/profile", { handle: "asha_ml", displayName: "Asha", bio: "SQL fan", public: true });
    const profile = (await req(null, "GET", "/profiles/ASHA_ML")).data;
    expect(profile).toMatchObject({ handle: "asha_ml", displayName: "Asha", bio: "SQL fan", solvedCount: 1 });
    expect(profile.recent[0]).toMatchObject({ itemId: "sql-null-not-equal-mcq" });
    expect(profile.tracks.find((t: { id: string }) => t.id === "sql-interview").solved).toBe(1);
    expect(JSON.stringify(profile)).not.toContain("asha@x.com");
  });

  it("short names", () => {
    expect(shortName("Asha Kumar")).toBe("Asha K.");
    expect(shortName("  meera  ")).toBe("meera");
    expect(shortName("")).toBe("Anonymous");
  });
});
