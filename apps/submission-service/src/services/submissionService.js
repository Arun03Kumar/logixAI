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
   *   ({ userId, problemId, code, language } with language upper-cased)
   */
  async addSubmission(submissionPayload) {
    const { problemId, userId, language } = submissionPayload;
    const problem = (await this.fetchProblemDetails(problemId)).data;

    const languageCodeStub = (problem.codeStubs || []).find(
      (codeStub) => codeStub.language.toUpperCase() === language,
    );
    if (!languageCodeStub) {
      throw new BadRequestError("language", {
        reason: `Problem does not support ${language}`,
      });
    }

    const testCases = problem.testCases || [];
    if (testCases.length === 0) {
      throw new BadRequestError("problem", {
        reason: "Problem has no test cases to judge against",
      });
    }

    const completeSubmissionCode = [
      languageCodeStub.startSnippet || "",
      submissionPayload.code,
      languageCodeStub.endSnippet || "",
    ].join("\n\n");

    const submission = await this.submissionRepository.createSubmission({
      ...submissionPayload,
      code: completeSubmissionCode,
    });

    const submissionId = String(submission._id);
    const queueResponse = await this.produceSubmissionJob({
      [submissionId]: {
        code: submission.code,
        language: submission.language,
        inputCase: testCases[0].input,
        outputCase: testCases[0].output,
        userId,
        submissionId,
        testCases,
      },
    });
    return { queueResponse, submission };
  }
}

module.exports = SubmissionService;
