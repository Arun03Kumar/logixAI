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
const LOAD_CACHE_MS = 2_000;

export function createQueueJudge(connection: Redis): JudgeGateway {
  const queues = new Map<string, Queue>();
  const loads = new Map<string, { at: number; load: { waiting: number; headWaitMs: number } }>();
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
      // Cached briefly: every Run asks, and the answer changes slowly.
      const cached = loads.get(language);
      if (cached && Date.now() - cached.at < LOAD_CACHE_MS) return cached.load;
      const queue = queueFor(language);
      const [counts, head] = await Promise.all([
        queue.getJobCounts("waiting", "prioritized"),
        // The next jobs to be judged (highest priority, oldest first).
        queue.getJobs(["prioritized", "waiting"], 0, 9, true),
      ]);
      const oldest = Math.min(...head.map((j) => j?.timestamp ?? Date.now()), Date.now());
      const load = { waiting: (counts.waiting ?? 0) + (counts.prioritized ?? 0), headWaitMs: Date.now() - oldest };
      loads.set(language, { at: Date.now(), load });
      return load;
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
