import express from "express";
import { Queue } from "bullmq";
import { JUDGE_QUEUES, LANGUAGES, judgeQueueGroup, type LanguageDefinition } from "@logixai/contracts";
import { closeRedis, createLogger, onShutdown, redisReady, registerHealthRoutes } from "@logixai/service-kit";
import redis from "./config/redisConfig.js";
import {
  BASE_TIME_LIMIT_MS,
  COMPILE_TIMEOUT_MS,
  JUDGE_CONCURRENCY,
  JUDGE_IMAGE_REGISTRY,
  JUDGE_QUEUES as SERVED,
  JUDGE_WARM_POOL,
  PORT,
  SUBMISSION_BUDGET_MS,
} from "./config/serverConfig.js";
import { DEFAULT_LIMITS } from "./judge/judge.js";
import { createDockerSandboxFactory, ensureImages, resolveImage } from "./sandbox/dockerSandbox.js";
import { createWarmPool } from "./sandbox/warmPool.js";
import submissionWorker from "./workers/submissionWorkers.js";

const logger = createLogger("evaluator-service");

async function start() {
  const groups = new Set(SERVED.map((s) => s.group));
  // Only the languages (and images) of the queues this evaluator serves.
  const languages = Object.values(LANGUAGES).filter((l: LanguageDefinition) => groups.has(judgeQueueGroup(l.id)));

  // Pull judge images before taking jobs, so the first submission isn't slow.
  await ensureImages(
    [...new Set(languages.map((l) => resolveImage(l.dockerImage, JUDGE_IMAGE_REGISTRY)))],
    (msg) => logger.info(msg),
  );

  // Started, unused sandboxes ready per language: a job doesn't wait for one to boot.
  const sandboxes = createWarmPool(createDockerSandboxFactory(undefined, JUDGE_IMAGE_REGISTRY), {
    size: JUDGE_WARM_POOL,
    languages,
    log: (msg) => logger.warn(msg),
  });
  const deps = {
    sandboxes,
    limits: {
      ...DEFAULT_LIMITS,
      baseTimeLimitMs: BASE_TIME_LIMIT_MS,
      compileTimeoutMs: COMPILE_TIMEOUT_MS,
      submissionBudgetMs: SUBMISSION_BUDGET_MS,
    },
    log: (msg: string) => logger.warn(msg),
  };
  const workers = SERVED.map(({ group, concurrency }) =>
    submissionWorker(JUDGE_QUEUES[group], deps, concurrency ?? JUDGE_CONCURRENCY),
  );
  // Read-only handles for queue lengths (autoscaling reads them via /queue-stats).
  const queues = SERVED.map(({ group }) => ({ group, queue: new Queue(JUDGE_QUEUES[group], { connection: redis }) }));

  const app = express();
  app.get("/ping", (_req, res) => {
    res.json({ message: "evaluator service is alive", queues: SERVED });
  });
  /**
   * Backlog of the queues this evaluator serves: jobs waiting for a judge.
   * KEDA (or any autoscaler) scales evaluators on `waiting`.
   */
  app.get("/queue-stats", async (_req, res) => {
    try {
      const byGroup: Record<string, { waiting: number; active: number }> = {};
      let waiting = 0;
      for (const { group, queue } of queues) {
        const c = await queue.getJobCounts("waiting", "prioritized", "active");
        const w = (c.waiting ?? 0) + (c.prioritized ?? 0);
        byGroup[group] = { waiting: w, active: c.active ?? 0 };
        waiting += w;
      }
      res.set("Cache-Control", "no-store").json({ waiting, queues: byGroup, warm: sandboxes.stats() });
    } catch (err) {
      res.status(503).json({ error: (err as Error).message });
    }
  });
  registerHealthRoutes(app, { redis: redisReady(redis) });
  const server = app.listen(PORT, () => {
    const served = SERVED.map((s) => `${s.group}×${s.concurrency ?? JUDGE_CONCURRENCY}`).join(", ");
    logger.info(`evaluator-service listening on port ${PORT} (queues: ${served}; warm pool ${JUDGE_WARM_POOL} per language)`);
  });
  onShutdown(
    [
      // Finishes the submissions being judged (their sandboxes are removed), takes no new ones.
      ["judge-workers", () => Promise.all(workers.map((w) => w.close()))],
      ["queues", () => Promise.all(queues.map(({ queue }) => queue.close()))],
      ["warm-pool", () => sandboxes.close()],
      ["http", () => new Promise<void>((resolve) => server.close(() => resolve()))],
      closeRedis(redis),
    ],
    // Judging a submission can take a while; give it time to finish.
    { logger, timeoutMs: 60_000 },
  );
}

start().catch((err) => {
  logger.error(`Failed to start evaluator-service: ${(err as Error).message}`);
  process.exit(1);
});
