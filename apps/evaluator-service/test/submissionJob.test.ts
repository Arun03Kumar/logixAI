import { beforeEach, describe, expect, it, vi } from "vitest";

const execute = vi.fn();
const produce = vi.fn(async () => {});

vi.mock("../src/utils/ExecutorFactory.js", () => ({
  default: (language: string) => (language === "PYTHON" ? { execute } : null),
}));
vi.mock("../src/producers/evaluationQueueProducer.js", () => ({
  default: produce,
}));

const { default: SubmissionJob } = await import("../src/jobs/SubmissiobJob.js");

function payload(language = "PYTHON") {
  return {
    s1: {
      code: "print(input())",
      language,
      inputCase: "1",
      outputCase: "1",
      userId: "u1",
      submissionId: "s1",
      testCases: [
        { input: "1", output: "1" },
        { input: "2", output: "2" },
        { input: "3", output: "3" },
      ],
    },
  };
}

beforeEach(() => {
  execute.mockReset();
  produce.mockClear();
});

describe("SubmissionJob", () => {
  it("runs every test case and waits for the result to be queued", async () => {
    execute
      .mockResolvedValueOnce({ status: "SUCCESS", output: "1" })
      .mockResolvedValueOnce({ status: "WA", output: "9" })
      .mockResolvedValueOnce({ status: "SUCCESS", output: "3" });

    await new SubmissionJob(payload()).handle();

    expect(execute).toHaveBeenCalledTimes(3);
    expect(produce).toHaveBeenCalledWith({
      userId: "u1",
      submissionId: "s1",
      response: [
        { status: "SUCCESS", output: "1" },
        { status: "WA", output: "9" },
        { status: "SUCCESS", output: "3" },
      ],
    });
  });

  it("stops at the first error", async () => {
    execute.mockResolvedValueOnce({ status: "ERROR", output: "TLE" });
    await new SubmissionJob(payload()).handle();
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("reports an unsupported language instead of dropping the job", async () => {
    await new SubmissionJob(payload("CPP")).handle();
    expect(produce).toHaveBeenCalledWith(
      expect.objectContaining({
        response: [{ status: "ERROR", output: "Unsupported language: CPP" }],
      }),
    );
  });

  it("rejects malformed payloads", () => {
    expect(() => new SubmissionJob({ s1: { code: "x" } })).toThrow();
  });
});
