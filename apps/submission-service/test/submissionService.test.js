import { describe, expect, it, vi } from "vitest";
import { BadRequestError } from "@logixai/service-kit";
import SubmissionService from "../src/services/submissionService";

/** Shape returned by problem-service's internal /problems/:id/judge. */
const problem = {
  codeStubs: [
    { language: "PYTHON", startSnippet: "# start", userSnippet: "", endSnippet: "# end" },
  ],
  sampleTestCases: [{ input: "1", output: "1" }],
  hiddenTestCases: [
    { input: "2", output: "4" },
    { input: "3", output: "9" },
  ],
};

function setup(problemData = problem) {
  const repo = {
    createSubmission: vi.fn(async (s) => ({ ...s, status: "Pending", _id: { toString: () => "sub1" } })),
  };
  const produceSubmissionJob = vi.fn(async () => "queued");
  const service = new SubmissionService(repo, {
    fetchProblemDetails: vi.fn(async () => ({ data: problemData })),
    produceSubmissionJob,
  });
  return { service, repo, produceSubmissionJob };
}

const input = {
  userId: "u1",
  problemId: "p1",
  code: "print(1)",
  language: "PYTHON",
  mode: "submit",
};

describe("SubmissionService.addSubmission", () => {
  it("submit judges samples + hidden tests with the hidden code added for the judge only", async () => {
    const { service, repo, produceSubmissionJob } = setup();
    const result = await service.addSubmission(input);

    // Stored: the student's code only, plus how many samples were judged.
    expect(repo.createSubmission.mock.calls[0][0]).toMatchObject({ code: "print(1)", sampleCount: 1, mode: "submit" });
    const job = produceSubmissionJob.mock.calls[0][0];
    expect(Object.keys(job)).toEqual(["sub1"]);
    expect(job.sub1.code).toBe("# start\n\nprint(1)\n\n# end");
    expect(job.sub1.testCases.map((t) => t.input)).toEqual(["1", "2", "3"]);
    // The response never echoes the full program back.
    expect(JSON.stringify(result.submission)).not.toContain("# start");
    expect(result.submission).toMatchObject({ _id: "sub1", mode: "submit", testCount: 3 });
  });

  it("run judges only the sample tests", async () => {
    const { service, produceSubmissionJob } = setup();
    await service.addSubmission({ ...input, mode: "run" });
    expect(produceSubmissionJob.mock.calls[0][0].sub1.testCases.map((t) => t.input)).toEqual(["1"]);
  });

  it("rejects a language the problem has no stub for", async () => {
    const { service, repo } = setup();
    await expect(service.addSubmission({ ...input, language: "JAVA" })).rejects.toBeInstanceOf(BadRequestError);
    expect(repo.createSubmission).not.toHaveBeenCalled();
  });

  it("rejects a problem without tests, and a run without samples", async () => {
    const empty = setup({ ...problem, sampleTestCases: [], hiddenTestCases: [] });
    await expect(empty.service.addSubmission(input)).rejects.toBeInstanceOf(BadRequestError);
    const noSamples = setup({ ...problem, sampleTestCases: [] });
    await expect(noSamples.service.addSubmission({ ...input, mode: "run" })).rejects.toBeInstanceOf(BadRequestError);
  });
});
