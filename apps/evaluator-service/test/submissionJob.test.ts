import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SandboxFactory } from "../src/sandbox/types.js";

const produce = vi.fn(async () => {});
vi.mock("../src/producers/evaluationQueueProducer.js", () => ({ default: produce }));

const { default: SubmissionJob } = await import("../src/jobs/SubmissiobJob.js");

/** Sandbox whose programs print the square of the last input written. */
const squaring: SandboxFactory = {
  async create() {
    let input = "";
    return {
      async exec(cmd, opts) {
        let stdout = "";
        if (cmd.join(" ").includes("cat > input.txt")) input = opts.stdin ?? "";
        else if (!cmd.join(" ").includes("cat >")) stdout = String(Number(input) ** 2);
        return { exitCode: 0, stdout, stderr: "", timedOut: false, outputLimited: false, durationMs: 5 };
      },
      async destroy() {},
    };
  },
};

const deps = {
  sandboxes: squaring,
  limits: { baseTimeLimitMs: 1000, compileTimeoutMs: 5000, submissionBudgetMs: 60_000, maxOutputBytes: 1024 },
};

function payload(extra: Record<string, unknown> = {}) {
  return {
    s1: {
      code: "print(int(input())**2)",
      language: "PYTHON",
      inputCase: "2",
      outputCase: "4",
      userId: "u1",
      submissionId: "s1",
      testCases: [
        { input: "2", output: "4" },
        { input: "3", output: "10" },
      ],
      ...extra,
    },
  };
}

beforeEach(() => produce.mockClear());

describe("SubmissionJob", () => {
  it("judges and publishes per-test verdicts on the default queue", async () => {
    await new SubmissionJob(payload(), deps).handle();
    expect(produce).toHaveBeenCalledWith(
      {
        userId: "u1",
        submissionId: "s1",
        response: [
          { status: "SUCCESS", output: "4", timeMs: 5 },
          { status: "WA", output: "9", timeMs: 5 },
        ],
      },
      "EvaluationQueue",
    );
  });

  it("replies on the queue the submitter asked for", async () => {
    await new SubmissionJob(payload({ replyQueue: "ExamEvaluationQueue" }), deps).handle();
    expect(produce).toHaveBeenLastCalledWith(expect.anything(), "ExamEvaluationQueue");
  });

  it("rejects malformed payloads", () => {
    expect(() => new SubmissionJob({ s1: { code: "x" } }, deps)).toThrow();
  });
});
