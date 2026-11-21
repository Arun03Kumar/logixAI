import { DEFAULT_TOKEN_ISSUER, FREE_DAILY_CODE_RUNS } from "@logixai/contracts";
import { env, loadConfig, z } from "@logixai/service-kit";

export const config = loadConfig(
  z
    .object({
      PORT: env.port(3010),
      NODE_ENV: env.nodeEnv(),
      DB_CONNECTION_STRING: z
        .string()
        .min(1)
        .default("mongodb://localhost:27017/logixai-arena"),
      REDIS_HOST: env.redisHost(),
      REDIS_PORT: env.redisPort(),
      REDIS_PASSWORD: env.redisPassword(),
      REDIS_TLS: env.flag(false),
      /** identity-service API, used for institution roles and batches. */
      IDENTITY_API_URL: env.url().default("http://localhost:3006/api/v1"),
      IDENTITY_JWKS_URL: env
        .url()
        .default("http://localhost:3006/.well-known/jwks.json"),
      JWT_ISSUER: z.string().default(DEFAULT_TOKEN_ISSUER),
      CORS_ORIGINS: env.list(["http://localhost:3008"]),
      /** Code runs (run + submit) per learner per minute. */
      CODE_RUNS_PER_MINUTE: z.coerce.number().int().positive().default(12),
      /** Server Runs get "busy, try again" (429) while more jobs than this wait in the judge queue. */
      JUDGE_BUSY_BACKLOG: z.coerce.number().int().positive().default(500),
      /** ...or while the next job to be judged has waited longer than this many seconds. */
      JUDGE_BUSY_WAIT_SECONDS: z.coerce.number().int().positive().default(30),
      /** Free-plan server runs per day per learner. Raise only on staging, for load tests. */
      FREE_DAILY_CODE_RUNS: z.coerce.number().int().positive().default(FREE_DAILY_CODE_RUNS),
    })
    .refine((c) => c.NODE_ENV !== "production" || Boolean(c.REDIS_PASSWORD), {
      message: "REDIS_PASSWORD is required in production",
      path: ["REDIS_PASSWORD"],
    }),
  { serviceName: "arena-service" },
);
