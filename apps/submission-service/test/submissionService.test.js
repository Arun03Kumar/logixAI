import { describe, expect, it, vi } from "vitest";
import { BadRequestError } from "@logixai/service-kit";
import SubmissionService from "../src/services/submissionService";

const problem = {
  codeStubs: [
    { language: "PYTHON", startSnippet: "# start", endSnippet: "# end" },
  ],
  testCases: [
    { input: "1", output: "1" },
    { input: "2", output: "4" },
  ],
};

function setup(problemData = problem) {
  const repo = {
    createSubmission: vi.fn(async (s) => ({ ...s, _id: { toString: () => "sub1" } })),
  };
  const produceSubmissionJob = vi.fn(async () => "queued");
  const service = new SubmissionService(repo, {
    fetchProblemDetails: vi.fn(async () => ({ data: problemData })),
    produceSubmissionJob,
  });
  return { service, repo, produceSubmissionJob };
}

const input = { userId: "u1", problemId: "p1", code: "print(1)", language: "PYTHON" };

describe("SubmissionService.addSubmission", () => {
  it("wraps user code in the stub and queues a job keyed by a string id", async () => {
    const { service, repo, produceSubmissionJob } = setup();
    await service.addSubmission(input);

    expect(repo.createSubmission.mock.calls[0][0].code).toBe(
      "# start\n\nprint(1)\n\n# end",
    );
    const job = produceSubmissionJob.mock.calls[0][0];
    expect(Object.keys(job)).toEqual(["sub1"]);
    expect(job.sub1).toMatchObject({
      submissionId: "sub1",
      language: "PYTHON",
      userId: "u1",
      testCases: problem.testCases,
    });
  });

  it("rejects a language the problem has no stub for", async () => {
    const { service, repo } = setup();
    await expect(
      service.addSubmission({ ...input, language: "JAVA" }),
    ).rejects.toBeInstanceOf(BadRequestError);
    expect(repo.createSubmission).not.toHaveBeenCalled();
  });

  it("rejects a problem without test cases", async () => {
    const { service } = setup({ ...problem, testCases: [] });
    await expect(service.addSubmission(input)).rejects.toBeInstanceOf(
      BadRequestError,
    );
  });

  it("tolerates missing start/end snippets", async () => {
    const { service, repo } = setup({
      ...problem,
      codeStubs: [{ language: "PYTHON" }],
    });
    await service.addSubmission(input);
    expect(repo.createSubmission.mock.calls[0][0].code).toBe("\n\nprint(1)\n\n");
  });
});
