import {
  JOB_NAMES,
  EvaluationJobPayloadSchema,
  type EvaluationJobPayload,
} from "@logixai/contracts";
import evaluationQueue from "../queues/evaluationQueue.js";

export default async function (payload: EvaluationJobPayload) {
  console.log("Adding job to evaluation queue with payload:", payload);
  // Validate against the shared contract before handing off to submission-service.
  const job = EvaluationJobPayloadSchema.parse(payload);
  await evaluationQueue.add(JOB_NAMES.EVALUATION, job);
  console.log("Job added to evaluation queue successfully");
}
