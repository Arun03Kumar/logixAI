const {
  EvaluationJobPayloadSchema,
  deriveSubmissionStatus,
} = require("@logixai/contracts");

/**
 * Blanks the output of hidden tests (index >= sampleCount) so a student can't
 * reconstruct hidden inputs or answers from their own program's output.
 * A compile error is a single result about the code, not a test, so it stays.
 */
function redactHidden(response, sampleCount) {
  if (response.length === 1 && response[0].status === "CE") return response;
  return response.map((r, i) => (i < sampleCount ? r : { ...r, output: "" }));
}

/**
 * Handles one EvaluationJob from the evaluator:
 * 1. stores the overall status on the submission,
 * 2. pushes the result to the user's browser through socket-service.
 *
 * A failed push (e.g. the user closed the tab) is logged, not retried:
 * the status is already saved.
 *
 * @param data raw job data
 * @param deps.submissionRepository has updateStatus(id, status) -> submission | null
 * @param deps.notifyUser async (userId, payload) => void
 * @param deps.logger console-like logger
 * @returns the stored status
 */
async function processEvaluation(
  data,
  { submissionRepository, notifyUser, logger = console },
) {
  const evaluation = EvaluationJobPayloadSchema.parse(data);
  const status = deriveSubmissionStatus(evaluation.response);

  const submission = await submissionRepository.updateStatus(evaluation.submissionId, status);
  const sampleCount = submission?.sampleCount ?? 0;
  const mode = submission?.mode ?? "submit";

  try {
    await notifyUser(evaluation.userId, {
      ...evaluation,
      response: redactHidden(evaluation.response, sampleCount),
      status,
      mode,
      sampleCount,
    });
  } catch (error) {
    logger.error(
      `Could not push result of submission ${evaluation.submissionId} to user ${evaluation.userId}: ${error.message}`,
    );
  }

  return status;
}

module.exports = processEvaluation;
