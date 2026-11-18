import { loadConfig, env, z } from "@logixai/service-kit";

const config = loadConfig(
  z.object({
    PORT: env.port(3002),
    NODE_ENV: env.nodeEnv(),
    REDIS_HOST: env.redisHost(),
    REDIS_PORT: env.redisPort(),
    /** Submissions judged at once by this process (one sandbox each). */
    JUDGE_CONCURRENCY: z.coerce.number().int().min(1).max(64).default(2),
    /** Per-test time limit before the language multiplier (C++ ×1, Java ×2, Python ×3). */
    BASE_TIME_LIMIT_MS: z.coerce.number().int().min(100).max(30_000).default(2000),
    COMPILE_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120_000).default(20_000),
    SUBMISSION_BUDGET_MS: z.coerce.number().int().min(1000).max(600_000).default(60_000),
  }),
  { serviceName: "evaluator-service" },
);

export const {
  PORT,
  NODE_ENV,
  REDIS_HOST,
  REDIS_PORT,
  JUDGE_CONCURRENCY,
  BASE_TIME_LIMIT_MS,
  COMPILE_TIMEOUT_MS,
  SUBMISSION_BUDGET_MS,
} = config;
