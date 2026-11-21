import { Queue, Worker } from "bullmq";
import type { Redis } from "ioredis";
import {
  EvaluationJobPayloadSchema,
  JOB_NAMES,
  QUEUE_NAMES,
  SubmissionJobPayloadSchema,
} from "@logixai/contracts";
import type { Logger } from "@logixai/service-kit";
import type { ArenaService, JudgeGateway } from "./services/arenaService.js";

/** Sends arena code to the shared judge (PYTHON_ML or NODE_WEB sandbox, JSON comparison). */
export function createQueueJudge(connection: Redis): JudgeGateway {
  const queue = new Queue(QUEUE_NAMES.SUBMISSION, { connection });
  return {
    async submit(request) {
      const payload = SubmissionJobPayloadSchema.parse({
        [request.submissionId]: {
          code: request.program,
          language: request.language,
          inputCase: request.tests[0]?.input ?? "",
          userId: request.userId,
          submissionId: request.submissionId,
          testCases: request.tests,
          replyQueue: QUEUE_NAMES.ARENA_EVALUATION,
          checker: request.checker,
        },
      });
      await queue.add(JOB_NAMES.SUBMISSION, payload, { removeOnComplete: 1000, removeOnFail: 1000 });
    },
  };
}

/** Applies judge results for arena code. */
export function startJudgeResultWorker(connection: Redis, arena: ArenaService, logger: Logger): Worker {
  const worker = new Worker(
    QUEUE_NAMES.ARENA_EVALUATION,
    async (job) => {
      if (job.name !== JOB_NAMES.EVALUATION) return;
      await arena.applyJudgeResult(EvaluationJobPayloadSchema.parse(job.data));
    },
    { connection },
  );
  worker.on("failed", (job, err) => logger.error(`Arena judge result ${job?.id} failed: ${err.message}`));
  return worker;
}
