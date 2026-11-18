import express from "express";
import { LANGUAGES } from "@logixai/contracts";
import { createLogger } from "@logixai/service-kit";
import {
  BASE_TIME_LIMIT_MS,
  COMPILE_TIMEOUT_MS,
  JUDGE_CONCURRENCY,
  PORT,
  SUBMISSION_BUDGET_MS,
} from "./config/serverConfig.js";
import { DEFAULT_LIMITS } from "./judge/judge.js";
import { createDockerSandboxFactory, ensureImages } from "./sandbox/dockerSandbox.js";
import submissionWorker from "./workers/submissionWorkers.js";

const logger = createLogger("evaluator-service");

async function start() {
  // Pull judge images before taking jobs, so the first submission isn't slow.
  await ensureImages(
    [...new Set(Object.values(LANGUAGES).map((l) => l.dockerImage))],
    (msg) => logger.info(msg),
  );

  submissionWorker(
    {
      sandboxes: createDockerSandboxFactory(),
      limits: {
        ...DEFAULT_LIMITS,
        baseTimeLimitMs: BASE_TIME_LIMIT_MS,
        compileTimeoutMs: COMPILE_TIMEOUT_MS,
        submissionBudgetMs: SUBMISSION_BUDGET_MS,
      },
      log: (msg) => logger.warn(msg),
    },
    JUDGE_CONCURRENCY,
  );

  const app = express();
  app.get("/ping", (_req, res) => {
    res.json({ message: "evaluator service is alive", concurrency: JUDGE_CONCURRENCY });
  });
  app.listen(PORT, () => {
    logger.info(`evaluator-service listening on port ${PORT} (judging ${JUDGE_CONCURRENCY} at a time)`);
  });
}

start().catch((err) => {
  logger.error(`Failed to start evaluator-service: ${(err as Error).message}`);
  process.exit(1);
});
