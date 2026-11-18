import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import type { InstitutionRole, MemberView } from "@logixai/contracts";
import { UnauthorizedError, type AccessTokenVerifier } from "@logixai/service-kit";
import { buildApp } from "../src/app.js";
import type { IdentityClient } from "../src/lib/identity.js";
import type { AttemptService, JudgeRequest } from "../src/services/attemptService.js";
import { createMemoryStore } from "../src/store/memoryStore.js";

const INST = "inst-1";

/** Tokens in tests are just "Bearer <userId>". */
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

const PEOPLE: Record<string, { role: InstitutionRole; batchIds: string[] }> = {
  teacher: { role: "instructor", batchIds: [] },
  asha: { role: "student", batchIds: ["cse"] },
  ravi: { role: "student", batchIds: ["cse"] },
  meera: { role: "student", batchIds: ["ece"] },
};

const identity: IdentityClient = {
  async getMembership(authorization, institutionId) {
    const user = authorization.replace(/^Bearer /, "");
    return institutionId === INST ? (PEOPLE[user] ?? null) : null;
  },
  async listMembers(): Promise<MemberView[]> {
    return Object.entries(PEOPLE).map(([userId, p]) => ({
      userId,
      name: userId[0]!.toUpperCase() + userId.slice(1),
      email: `${userId}@x.com`,
      role: p.role,
      batchIds: p.batchIds,
      joinedAt: new Date().toISOString(),
    }));
  },
};

let app: FastifyInstance;
let attempts: AttemptService;
let judged: JudgeRequest[];

async function setup() {
  judged = [];
  const built = await buildApp({
    store: createMemoryStore(),
    identity,
    judge: { submit: async (r) => void judged.push(r) },
    verifier,
    corsOrigins: [],
  });
  app = built.app;
  attempts = built.attempts;
}

const as = (user: string) => ({ authorization: `Bearer ${user}` });
async function req(user: string, method: string, url: string, payload?: unknown) {
  const res = await app.inject({ method: method as never, url, headers: as(user), payload: payload as never });
  return { status: res.statusCode, body: res.json(), raw: res.body };
}

function draft(overrides: Record<string, unknown> = {}) {
  const now = Date.now();
  return {
    title: "Data structures mid-term",
    instructions: "Answer all questions.",
    durationMinutes: 30,
    startsAt: new Date(now - 60_000).toISOString(),
    endsAt: new Date(now + 2 * 60 * 60_000).toISOString(),
    batchIds: ["cse"],
    settings: { resultsVisibility: "after_submit" },
    questions: [
      {
        id: "q1",
        type: "mcq_single",
        prompt: "Which structure is FIFO?",
        marks: 2,
        options: [
          { id: "a", text: "Stack" },
          { id: "b", text: "Queue" },
        ],
        correctOptionIds: ["b"],
      },
      {
        id: "q2",
        type: "mcq_multi",
        prompt: "Which are O(1) on a hash map (average)?",
        marks: 3,
        options: [
          { id: "a", text: "Insert" },
          { id: "b", text: "Lookup" },
          { id: "c", text: "Sorted iteration" },
        ],
        correctOptionIds: ["a", "b"],
      },
      {
        id: "q3",
        type: "coding",
        prompt: "Print n squared.",
        marks: 6,
        languages: ["PYTHON"],
        codeStubs: [
          { language: "PYTHON", startSnippet: "# start", userSnippet: "def sq(n):\n    pass", endSnippet: "print(sq(int(input())))" },
        ],
        sampleTestCases: [{ input: "2", output: "4" }],
        hiddenTestCases: [
          { input: "3", output: "HIDDEN_9" },
          { input: "4", output: "HIDDEN_16" },
        ],
      },
    ],
    ...overrides,
  };
}

async function publishedExam(overrides: Record<string, unknown> = {}) {
  const created = await req("teacher", "POST", `/api/v1/institutions/${INST}/exams`, { title: "Mid-term" });
  const id = created.body.data.id as string;
  expect((await req("teacher", "PUT", `/api/v1/exams/${id}`, draft(overrides))).status).toBe(200);
  const pub = await req("teacher", "POST", `/api/v1/exams/${id}/publish`);
  expect(pub.status).toBe(200);
  return id;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("authoring", () => {
  it("only staff create exams, and drafts stay hidden from students", async () => {
    await setup();
    expect((await req("asha", "POST", `/api/v1/institutions/${INST}/exams`, { title: "X" })).status).toBe(403);
    const created = await req("teacher", "POST", `/api/v1/institutions/${INST}/exams`, { title: "Quiz" });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ status: "draft", phase: "draft" });

    expect((await req("asha", "GET", `/api/v1/institutions/${INST}/exams`)).body.data).toEqual([]);
    expect((await req("asha", "GET", `/api/v1/exams/${created.body.data.id}`)).status).toBe(404);
    expect((await req("outsider", "GET", `/api/v1/institutions/${INST}/exams`)).status).toBe(404);
  });

  it("explains what's missing before publishing", async () => {
    await setup();
    const { body } = await req("teacher", "POST", `/api/v1/institutions/${INST}/exams`, { title: "Quiz" });
    const res = await req("teacher", "POST", `/api/v1/exams/${body.data.id}/publish`);
    expect(res.status).toBe(400);
    expect(res.body.error.problems).toEqual(
      expect.arrayContaining(["Set when the exam opens and closes.", "Add at least one question."]),
    );

    const bad = draft();
    (bad.questions[0] as { correctOptionIds: string[] }).correctOptionIds = [];
    (bad.questions[2] as { hiddenTestCases: unknown[] }).hiddenTestCases.push({ input: " ", output: "" });
    await req("teacher", "PUT", `/api/v1/exams/${body.data.id}`, bad);
    const again = await req("teacher", "POST", `/api/v1/exams/${body.data.id}/publish`);
    expect(again.body.error.problems).toEqual(
      expect.arrayContaining([
        "Question 1: mark the correct answer.",
        "Question 3: fill in or remove empty test cases.",
      ]),
    );
  });

  it("locks editing once published and unpublishing once started", async () => {
    await setup();
    const id = await publishedExam();
    expect((await req("teacher", "PUT", `/api/v1/exams/${id}`, draft())).status).toBe(409);
    await req("asha", "POST", `/api/v1/exams/${id}/attempts`);
    expect((await req("teacher", "POST", `/api/v1/exams/${id}/unpublish`)).status).toBe(409);
  });
});

describe("taking an exam", () => {
  it("only assigned students can start, and they never see answers or hidden tests", async () => {
    await setup();
    const id = await publishedExam();
    expect((await req("meera", "GET", `/api/v1/institutions/${INST}/exams`)).body.data).toEqual([]);
    expect((await req("meera", "POST", `/api/v1/exams/${id}/attempts`)).status).toBe(403);

    const start = await req("asha", "POST", `/api/v1/exams/${id}/attempts`);
    expect(start.status).toBe(200);
    expect(start.raw).not.toContain("correctOptionIds");
    expect(start.raw).not.toContain("HIDDEN_");
    const coding = start.body.data.questions.find((q: { id: string }) => q.id === "q3");
    expect(coding).toMatchObject({
      starterCode: { PYTHON: "def sq(n):\n    pass" },
      sampleTestCases: [{ input: "2", output: "4" }],
    });
    expect(start.raw).not.toContain("# start");

    // Starting again resumes the same attempt.
    const again = await req("asha", "POST", `/api/v1/exams/${id}/attempts`);
    expect(again.body.data.id).toBe(start.body.data.id);
    // Others can't read it.
    expect((await req("ravi", "GET", `/api/v1/attempts/${start.body.data.id}`)).status).toBe(404);
  });

  it("autosaves, judges coding answers and grades on submit", async () => {
    await setup();
    const id = await publishedExam();
    const attemptId = (await req("asha", "POST", `/api/v1/exams/${id}/attempts`)).body.data.id;
    const save = (q: string, body: unknown) =>
      req("asha", "PUT", `/api/v1/attempts/${attemptId}/answers/${q}`, body);

    expect((await save("q1", { selectedOptionIds: ["a", "b"] })).status).toBe(400);
    expect((await save("q1", { selectedOptionIds: ["b"] })).status).toBe(200);
    expect((await save("q2", { selectedOptionIds: ["a"] })).status).toBe(200);
    expect((await save("q3", { code: "def sq(n):\n    return n*n", language: "PYTHON" })).status).toBe(200);

    const run = await req("asha", "POST", `/api/v1/attempts/${attemptId}/answers/q3/run`);
    expect(run.body.data.answers.q3.judge).toMatchObject({ status: "pending", total: 3 });
    expect(judged).toHaveLength(1);
    expect(judged[0]!.code).toBe("# start\n\ndef sq(n):\n    return n*n\n\nprint(sq(int(input())))");
    expect(judged[0]!.testCases.map((t) => t.output)).toEqual(["4", "HIDDEN_9", "HIDDEN_16"]);

    // Second run while the first is pending is refused.
    expect((await req("asha", "POST", `/api/v1/attempts/${attemptId}/answers/q3/run`)).status).toBe(409);

    await attempts.applyJudgeResult({
      submissionId: judged[0]!.submissionId,
      userId: "asha",
      response: [
        { status: "SUCCESS", output: "4" },
        { status: "SUCCESS", output: "9" },
        { status: "WA", output: "WRONG_OUTPUT_MARKER" },
      ],
    });
    const view = await req("asha", "GET", `/api/v1/attempts/${attemptId}`);
    expect(view.body.data.answers.q3.judge).toMatchObject({ status: "done", passed: 2, total: 3 });
    expect(view.raw).not.toContain("WRONG_OUTPUT_MARKER"); // hidden test output never echoed back

    const submitted = await req("asha", "POST", `/api/v1/attempts/${attemptId}/submit`);
    expect(submitted.body.data.status).toBe("submitted");

    // q1 right (2), q2 partly wrong (0), q3 2/3 of 6 = 4
    const result = await req("asha", "GET", `/api/v1/exams/${id}/my-result`);
    expect(result.body.data).toMatchObject({ score: 6, maxScore: 11 });
    expect(judged).toHaveLength(1); // unchanged code isn't judged again

    expect((await save("q1", { selectedOptionIds: ["a"] })).status).toBe(409);
  });

  it("judges unrun code at submission and fills in the score later", async () => {
    await setup();
    const id = await publishedExam();
    const attemptId = (await req("asha", "POST", `/api/v1/exams/${id}/attempts`)).body.data.id;
    await req("asha", "PUT", `/api/v1/attempts/${attemptId}/answers/q3`, {
      code: "def sq(n):\n    return n*n",
      language: "PYTHON",
    });
    await req("asha", "POST", `/api/v1/attempts/${attemptId}/submit`);
    expect(judged).toHaveLength(1);
    expect((await req("asha", "GET", `/api/v1/exams/${id}/my-result`)).body.data.score).toBeNull();

    await attempts.applyJudgeResult({
      submissionId: judged[0]!.submissionId,
      userId: "asha",
      response: [
        { status: "SUCCESS", output: "4" },
        { status: "SUCCESS", output: "9" },
        { status: "SUCCESS", output: "16" },
      ],
    });
    expect((await req("asha", "GET", `/api/v1/exams/${id}/my-result`)).body.data.score).toBe(6);
  });

  it("auto-submits when time runs out", async () => {
    await setup();
    const id = await publishedExam();
    const attemptId = (await req("asha", "POST", `/api/v1/exams/${id}/attempts`)).body.data.id;
    await req("asha", "PUT", `/api/v1/attempts/${attemptId}/answers/q1`, { selectedOptionIds: ["b"] });

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 31 * 60_000);
    expect(
      (await req("asha", "PUT", `/api/v1/attempts/${attemptId}/answers/q1`, { selectedOptionIds: ["a"] })).status,
    ).toBe(409);
    expect(await attempts.sweepExpired()).toBe(1);
    const view = await req("asha", "GET", `/api/v1/attempts/${attemptId}`);
    expect(view.body.data.status).toBe("auto_submitted");
    expect((await req("asha", "GET", `/api/v1/exams/${id}/my-result`)).body.data.score).toBe(2);
  });

  it("hides scores until the exam ends when configured", async () => {
    await setup();
    const id = await publishedExam({ settings: { resultsVisibility: "after_end" } });
    const attemptId = (await req("asha", "POST", `/api/v1/exams/${id}/attempts`)).body.data.id;
    await req("asha", "PUT", `/api/v1/attempts/${attemptId}/answers/q1`, { selectedOptionIds: ["b"] });
    await req("asha", "POST", `/api/v1/attempts/${attemptId}/submit`);
    const result = (await req("asha", "GET", `/api/v1/exams/${id}/my-result`)).body.data;
    expect(result).toMatchObject({ released: false, score: null });
    expect(result.questions[0]).not.toHaveProperty("correctOptionIds");
  });
});

describe("results and proctoring", () => {
  it("gives staff a results table and each attempt's proctoring log", async () => {
    await setup();
    const id = await publishedExam();
    const attemptId = (await req("asha", "POST", `/api/v1/exams/${id}/attempts`)).body.data.id;
    await req("asha", "POST", `/api/v1/attempts/${attemptId}/events`, { type: "tab_hidden" });
    await req("asha", "POST", `/api/v1/attempts/${attemptId}/events`, { type: "paste" });
    expect((await req("asha", "POST", `/api/v1/attempts/${attemptId}/events`, { type: "hack" })).status).toBe(400);
    await req("asha", "PUT", `/api/v1/attempts/${attemptId}/answers/q1`, { selectedOptionIds: ["b"] });
    await req("asha", "POST", `/api/v1/attempts/${attemptId}/submit`);

    expect((await req("asha", "GET", `/api/v1/exams/${id}/results`)).status).toBe(403);
    const results = await req("teacher", "GET", `/api/v1/exams/${id}/results`);
    expect(results.body.data.rows).toEqual([
      expect.objectContaining({ name: "Asha", status: "submitted", score: 2, maxScore: 11, proctorEventCount: 2 }),
    ]);

    const review = await req("teacher", "GET", `/api/v1/exams/${id}/attempts/${attemptId}`);
    expect(review.body.data.proctorEvents.map((e: { type: string }) => e.type)).toEqual(["tab_hidden", "paste"]);
    expect(review.body.data.questions[0]).toMatchObject({ correctOptionIds: ["b"], score: 2 });
  });
});
