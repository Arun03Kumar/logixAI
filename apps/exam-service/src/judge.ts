import { Queue, Worker } from "bullmq";
import type { Redis } from "ioredis";
import {
  EvaluationJobPayloadSchema,
  JOB_NAMES,
  JUDGE_PRIORITY,
  QUEUE_NAMES,
  SubmissionJobPayloadSchema,
  judgeJobOptions,
  judgeQueueFor,
} from "@logixai/contracts";
import type { Logger } from "@logixai/service-kit";
import type { AttemptService, JudgeGateway } from "./services/attemptService.js";

/**
 * Sends exam code to the judge (the queue for its language) at the highest
 * priority, and asks for replies on the exam queue.
 */
export function createQueueJudge(connection: Redis): JudgeGateway {
  const queues = new Map<string, Queue>();
  const queueFor = (language: Parameters<typeof judgeQueueFor>[0]) => {
    const name = judgeQueueFor(language);
    let queue = queues.get(name);
    if (!queue) {
      queue = new Queue(name, { connection });
      queues.set(name, queue);
    }
    return queue;
  };
  return {
    async submit(request) {
      const first = request.testCases[0];
      const payload = SubmissionJobPayloadSchema.parse({
        [request.submissionId]: {
          code: request.code,
          language: request.language,
          inputCase: first?.input ?? "",
          outputCase: first?.output,
          userId: request.userId,
          submissionId: request.submissionId,
          testCases: request.testCases,
          replyQueue: QUEUE_NAMES.EXAM_EVALUATION,
        },
      });
      await queueFor(request.language).add(JOB_NAMES.SUBMISSION, payload, judgeJobOptions(JUDGE_PRIORITY.exam));
    },
  };
}

/** Applies judge results for exam answers. */
export function startJudgeResultWorker(
  connection: Redis,
  attempts: AttemptService,
  logger: Logger,
): Worker {
  const worker = new Worker(
    QUEUE_NAMES.EXAM_EVALUATION,
    async (job) => {
      if (job.name !== JOB_NAMES.EVALUATION) return;
      await attempts.applyJudgeResult(EvaluationJobPayloadSchema.parse(job.data));
    },
    { connection },
  );
  worker.on("failed", (job, err) => {
    logger.error(`Exam judge result ${job?.id} failed: ${err.message}`);
  });
  return worker;
}
