import { loadConfig, env, z } from "@logixai/service-kit";

const config = loadConfig(
  z.object({
    PORT: env.port(3002),
    NODE_ENV: env.nodeEnv(),
    REDIS_HOST: env.redisHost(),
    REDIS_PORT: env.redisPort(),
  }),
  { serviceName: "evaluator-service" },
);

export const { PORT, NODE_ENV, REDIS_HOST, REDIS_PORT } = config;
