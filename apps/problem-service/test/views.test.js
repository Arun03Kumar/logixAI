import { describe, expect, it, vi } from "vitest";
import { createRequireInternalOrAdmin } from "../src/middlewares/auth";
import { toJudgeProblem, toProblemSummary, toPublicProblem } from "../src/utils/problemViews";

const problem = {
  _id: "p1",
  title: "Square",
  description: "Print n squared",
  difficulty: "easy",
  sampleTestCases: [{ input: "2", output: "4" }],
  testCases: [{ input: "3", output: "SECRET_9" }],
  codeStubs: [{ language: "PYTHON", startSnippet: "HIDDEN_START", userSnippet: "def sq(n):", endSnippet: "HIDDEN_END" }],
};

describe("problem views", () => {
  it("never exposes hidden tests or hidden code publicly", () => {
    const json = JSON.stringify([toPublicProblem(problem), toProblemSummary(problem)]);
    expect(json).not.toMatch(/SECRET_9|HIDDEN_START|HIDDEN_END/);
    expect(toPublicProblem(problem)).toMatchObject({
      sampleTestCases: [{ input: "2", output: "4" }],
      hiddenTestCount: 1,
      codeStubs: [{ language: "PYTHON", userSnippet: "def sq(n):" }],
    });
  });

  it("gives the judge everything", () => {
    expect(toJudgeProblem(problem)).toMatchObject({
      sampleTestCases: [{ input: "2", output: "4" }],
      hiddenTestCases: [{ input: "3", output: "SECRET_9" }],
      codeStubs: [{ startSnippet: "HIDDEN_START", endSnippet: "HIDDEN_END" }],
    });
  });

  it("treats the first two tests of older problems as samples", () => {
    const legacy = { ...problem, sampleTestCases: [], testCases: ["1", "2", "3"].map((n) => ({ input: n, output: n })) };
    expect(toPublicProblem(legacy).sampleTestCases).toHaveLength(2);
    expect(toPublicProblem(legacy).hiddenTestCount).toBe(1);
  });
});

describe("requireInternalOrAdmin", () => {
  const verifier = {
    verifyHeader: vi.fn(async (h) => {
      if (h === "Bearer admin") return { sub: "a", role: "admin" };
      if (h === "Bearer user") return { sub: "u", role: "user" };
      throw Object.assign(new Error("no"), { statusCode: 401 });
    }),
  };
  const run = async (headers) => {
    const next = vi.fn();
    await createRequireInternalOrAdmin(verifier, "s3cret")({ headers }, {}, next);
    return next.mock.calls[0]?.[0];
  };

  it("lets services with the shared token and admins through", async () => {
    expect(await run({ "x-internal-token": "s3cret" })).toBeUndefined();
    expect(await run({ authorization: "Bearer admin" })).toBeUndefined();
  });

  it("refuses everyone else", async () => {
    expect((await run({})).statusCode).toBe(401);
    expect((await run({ "x-internal-token": "guess" })).statusCode).toBe(401);
    expect((await run({ authorization: "Bearer user" })).statusCode).toBe(403);
  });
});
