const {
  EvaluationJobPayloadSchema,
  deriveSubmissionStatus,
} = require("@logixai/contracts");

/**
 * Handles one EvaluationJob from the evaluator:
 * 1. stores the overall status on the submission,
 * 2. pushes the result to the user's browser through socket-service.
 *
 * A failed push (e.g. the user closed the tab) is logged, not retried:
 * the status is already saved.
 *
 * @param data raw job data
 * @param deps.submissionRepository has updateStatus(id, status)
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

  await submissionRepository.updateStatus(evaluation.submissionId, status);

  try {
    await notifyUser(evaluation.userId, { ...evaluation, status });
  } catch (error) {
    logger.error(
      `Could not push result of submission ${evaluation.submissionId} to user ${evaluation.userId}: ${error.message}`,
    );
  }

  return status;
}

module.exports = processEvaluation;
