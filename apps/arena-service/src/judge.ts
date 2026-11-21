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
import type { ArenaService, JudgeGateway, JudgeRequest } from "./services/arenaService.js";

/**
 * Sends arena code to the judge: the queue for its sandbox image
 * (python-ml or node-web), with Submit ahead of Run.
 */
export function createQueueJudge(connection: Redis): JudgeGateway {
  const queues = new Map<string, Queue>();
  const queueFor = (language: JudgeRequest["language"]) => {
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
      await queueFor(request.language).add(
        JOB_NAMES.SUBMISSION,
        payload,
        judgeJobOptions(request.mode === "submit" ? JUDGE_PRIORITY.submit : JUDGE_PRIORITY.run),
      );
    },
    async backlog(language) {
      const counts = await queueFor(language).getJobCounts("waiting", "prioritized");
      return (counts.waiting ?? 0) + (counts.prioritized ?? 0);
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
