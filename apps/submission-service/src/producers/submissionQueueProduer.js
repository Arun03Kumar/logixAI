const {
  JOB_NAMES,
  JUDGE_PRIORITY,
  SubmissionJobPayloadSchema,
  judgeJobOptions,
} = require("@logixai/contracts");
const { judgeQueue } = require("../queues/submissionQueue");

/**
 * Queues a DSA submission for the judge. `mode` "submit" is judged before
 * "run" when the queue is busy.
 */
module.exports = async function (payload, mode = "submit") {
  // Validate against the shared contract so a shape change is caught here,
  // not as a confusing failure inside the evaluator.
  const job = SubmissionJobPayloadSchema.parse(payload);
  const { language } = Object.values(job)[0];
  await judgeQueue(language).add(
    JOB_NAMES.SUBMISSION,
    job,
    judgeJobOptions(mode === "run" ? JUDGE_PRIORITY.run : JUDGE_PRIORITY.submit),
  );
};
