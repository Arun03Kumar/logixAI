import { Worker } from "bullmq";
import { JOB_NAMES } from "@logixai/contracts";
import redis from "../config/redisConfig.js";
import SubmissionJob, { type SubmissionJobDeps } from "../jobs/SubmissiobJob.js";

/**
 * Consumes one judge queue. `concurrency` submissions from it are judged in
 * parallel by this process; run more evaluator instances to scale out.
 * Higher-priority jobs (exams, then Submit, then Run) are taken first.
 */
export default function submissionWorker(queueName: string, deps: SubmissionJobDeps, concurrency: number) {
  const worker = new Worker(
    queueName,
    async (job) => {
      if (job.name !== JOB_NAMES.SUBMISSION) return undefined;
      // Awaited so BullMQ only marks the job complete once judging is done.
      await new SubmissionJob(job.data, deps).handle();
      return true;
    },
    { connection: redis, concurrency },
  );

  worker.on("failed", (job, err) => {
    deps.log?.(`Submission job ${job?.id} on ${queueName} failed: ${err.message}`);
  });

  return worker;
}
