import { Queue } from "bullmq";
import {
  JOB_NAMES,
  QUEUE_NAMES,
  EvaluationJobPayloadSchema,
  type EvaluationJobPayload,
} from "@logixai/contracts";
import redis from "../config/redisConfig.js";

// One Queue per reply destination (practice, exams, ...), created on demand.
const queues = new Map<string, Queue>();

function queueFor(name: string): Queue {
  let queue = queues.get(name);
  if (!queue) {
    queue = new Queue(name, { connection: redis });
    queues.set(name, queue);
  }
  return queue;
}

/** Publishes a judge result to the queue the submitter asked for. */
export default async function (
  payload: EvaluationJobPayload,
  replyQueue: string = QUEUE_NAMES.EVALUATION,
) {
  // Validate against the shared contract before handing off.
  const job = EvaluationJobPayloadSchema.parse(payload);
  await queueFor(replyQueue).add(JOB_NAMES.EVALUATION, job);
}
