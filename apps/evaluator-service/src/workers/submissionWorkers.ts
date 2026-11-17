import { Job, Worker } from "bullmq";
import { JOB_NAMES } from "@logixai/contracts";
import redis from "../config/redisConfig.js";
import SubmissionJob from "../jobs/SubmissiobJob.js";

export default function submissionWorker(queueName: string) {
  const worker = new Worker(
    queueName,
    async (job: Job) => {
      if (job.name === JOB_NAMES.SUBMISSION) {
        const submissionJobInstance = new SubmissionJob(job.data);
        // Awaited so BullMQ only marks the job complete once judging is done,
        // and records it as failed (with retries possible) if it throws.
        await submissionJobInstance.handle(job);
        return true;
      }
      return undefined;
    },
    { connection: redis },
  );

  worker.on("failed", (job, err) => {
    console.error(`Submission job ${job?.id} failed:`, err.message);
  });

  return worker;
}
