import { Worker } from "bullmq";
import { JOB_NAMES, QUEUE_NAMES } from "@logixai/contracts";
import redis from "../config/redisConfig.js";
import SubmissionJob, { type SubmissionJobDeps } from "../jobs/SubmissiobJob.js";

/**
 * Consumes the shared SubmissionQueue. `concurrency` submissions are judged
 * in parallel by this process; run more evaluator instances to scale out.
 */
export default function submissionWorker(deps: SubmissionJobDeps, concurrency: number) {
  const worker = new Worker(
    QUEUE_NAMES.SUBMISSION,
    async (job) => {
      if (job.name !== JOB_NAMES.SUBMISSION) return undefined;
      // Awaited so BullMQ only marks the job complete once judging is done.
      await new SubmissionJob(job.data, deps).handle();
      return true;
    },
    { connection: redis, concurrency },
  );

  worker.on("failed", (job, err) => {
    deps.log?.(`Submission job ${job?.id} failed: ${err.message}`);
  });

  return worker;
}
