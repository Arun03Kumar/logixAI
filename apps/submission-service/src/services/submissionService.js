const { BadRequestError } = require("@logixai/service-kit");

class SubmissionService {
  /**
   * @param submissionRepository persistence for submissions
   * @param deps.fetchProblemDetails (problemId) => problem-service response
   * @param deps.produceSubmissionJob (payload) => enqueue for the evaluator
   */
  constructor(
    submissionRepository,
    {
      fetchProblemDetails = require("../apis/problemAdminApi"),
      produceSubmissionJob = require("../producers/submissionQueueProduer"),
    } = {},
  ) {
    this.submissionRepository = submissionRepository;
    this.fetchProblemDetails = fetchProblemDetails;
    this.produceSubmissionJob = produceSubmissionJob;
  }

  async pingCheck() {
    return "pong1";
  }

  /**
   * @param submissionPayload validated CreateSubmissionInput
   *   ({ userId, problemId, code, language, mode } with language upper-cased)
   *
   * "run" judges the sample tests only; "submit" judges samples + hidden tests.
   */
  async addSubmission(submissionPayload) {
    const { problemId, userId, language, mode } = submissionPayload;
    const problem = (await this.fetchProblemDetails(problemId)).data;

    const languageCodeStub = (problem.codeStubs || []).find(
      (codeStub) => codeStub.language.toUpperCase() === language,
    );
    if (!languageCodeStub) {
      throw new BadRequestError("language", {
        reason: `Problem does not support ${language}`,
      });
    }

    const samples = problem.sampleTestCases || [];
    const hidden = problem.hiddenTestCases || [];
    const testCases = mode === "run" ? samples : [...samples, ...hidden];
    if (testCases.length === 0) {
      throw new BadRequestError("problem", {
        reason:
          mode === "run"
            ? "This problem has no sample tests to run. Submit to check against all tests."
            : "Problem has no test cases to judge against",
      });
    }

    // Only the student's own code is stored; the hidden code around it is
    // added just for the judge.
    const submission = await this.submissionRepository.createSubmission({
      ...submissionPayload,
      sampleCount: samples.length,
    });

    const submissionId = String(submission._id);
    const fullCode = [
      languageCodeStub.startSnippet || "",
      submissionPayload.code,
      languageCodeStub.endSnippet || "",
    ].join("\n\n");

    const queueResponse = await this.produceSubmissionJob({
      [submissionId]: {
        code: fullCode,
        language: submission.language,
        inputCase: testCases[0].input,
        outputCase: testCases[0].output,
        userId,
        submissionId,
        testCases,
      },
    });
    return {
      queueResponse,
      submission: {
        _id: submissionId,
        problemId: submission.problemId,
        language: submission.language,
        mode: submission.mode,
        status: submission.status,
        testCount: testCases.length,
      },
    };
  }
}

module.exports = SubmissionService;
