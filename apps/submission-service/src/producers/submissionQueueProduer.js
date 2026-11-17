const {
  JOB_NAMES,
  SubmissionJobPayloadSchema,
} = require("@logixai/contracts");
const submissionQueue = require("../queues/submissionQueue");

module.exports = async function (payload) {
  // Validate against the shared contract so a shape change is caught here,
  // not as a confusing failure inside the evaluator.
  const job = SubmissionJobPayloadSchema.parse(payload);
  await submissionQueue.add(JOB_NAMES.SUBMISSION, job);
  console.log("submission job added");
};
