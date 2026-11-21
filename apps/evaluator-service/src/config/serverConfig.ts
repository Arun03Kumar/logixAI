import { JUDGE_QUEUE_GROUPS, type JudgeQueueGroup } from "@logixai/contracts";
import { loadConfig, env, z } from "@logixai/service-kit";

const config = loadConfig(
  z.object({
    PORT: env.port(3002),
    NODE_ENV: env.nodeEnv(),
    REDIS_HOST: env.redisHost(),
    REDIS_PORT: env.redisPort(),
    REDIS_PASSWORD: env.redisPassword(),
    REDIS_TLS: env.flag(false),
    /** Submissions judged at once per queue group by this process (one sandbox each). */
    JUDGE_CONCURRENCY: z.coerce.number().int().min(1).max(64).default(2),
    /**
     * Queue groups this evaluator serves, optionally with their own
     * concurrency: "python-ml:3,node-web:1,dsa:2". Default: every group at
     * JUDGE_CONCURRENCY. Run separate evaluators per group to scale each on
     * its own queue.
     */
    JUDGE_QUEUES: z
      .string()
      .optional()
      .transform((v, ctx) => {
        const entries = (v?.trim() ? v.split(",") : JUDGE_QUEUE_GROUPS).map((part) => part.trim()).filter(Boolean);
        const out: { group: JudgeQueueGroup; concurrency?: number }[] = [];
        for (const entry of entries) {
          const [group, n] = entry.split(":");
          if (!JUDGE_QUEUE_GROUPS.includes(group as JudgeQueueGroup)) {
            ctx.addIssue({ code: "custom", message: `unknown queue group "${group}" (use ${JUDGE_QUEUE_GROUPS.join(", ")})` });
            return z.NEVER;
          }
          const concurrency = n === undefined ? undefined : Number(n);
          if (concurrency !== undefined && !(Number.isInteger(concurrency) && concurrency >= 1 && concurrency <= 64)) {
            ctx.addIssue({ code: "custom", message: `bad concurrency in "${entry}"` });
            return z.NEVER;
          }
          out.push({ group: group as JudgeQueueGroup, ...(concurrency ? { concurrency } : {}) });
        }
        return out;
      }),
    /** Started, unused sandboxes kept ready per language (0 = off). */
    JUDGE_WARM_POOL: z.coerce.number().int().min(0).max(16).default(1),
    /** Per-test time limit before the language multiplier (C++ ×1, Java ×2, Python ×3). */
    BASE_TIME_LIMIT_MS: z.coerce.number().int().min(100).max(30_000).default(2000),
    COMPILE_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120_000).default(20_000),
    SUBMISSION_BUDGET_MS: z.coerce.number().int().min(1000).max(600_000).default(60_000),
    /**
     * Registry the LogixAI judge images are pulled from in production, e.g.
     * `ghcr.io/acme` makes `logixai/python-ml:4` -> `ghcr.io/acme/python-ml:4`.
     * Unset: the local images built by `npm run judge:images`.
     */
    JUDGE_IMAGE_REGISTRY: z
      .string()
      .trim()
      .regex(/^[a-z0-9][a-z0-9._:/-]*$/i, "a registry path like ghcr.io/acme")
      .optional()
      .transform((v) => (v ? v.replace(/\/+$/, "") : undefined)),
  })
  .refine((c) => c.NODE_ENV !== "production" || Boolean(c.REDIS_PASSWORD), {
    message: "REDIS_PASSWORD is required in production",
    path: ["REDIS_PASSWORD"],
  }),
  { serviceName: "evaluator-service" },
);

export const {
  PORT,
  NODE_ENV,
  REDIS_HOST,
  REDIS_PORT,
  REDIS_PASSWORD,
  REDIS_TLS,
  JUDGE_CONCURRENCY,
  BASE_TIME_LIMIT_MS,
  COMPILE_TIMEOUT_MS,
  SUBMISSION_BUDGET_MS,
  JUDGE_IMAGE_REGISTRY,
  JUDGE_QUEUES,
  JUDGE_WARM_POOL,
} = config;
