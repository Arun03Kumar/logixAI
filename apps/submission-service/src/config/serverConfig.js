const { loadConfig, env, z } = require("@logixai/service-kit");

module.exports = loadConfig(
  z.object({
    PORT: env.port(3000),
    NODE_ENV: env.nodeEnv(),
    REDIS_HOST: env.redisHost(),
    REDIS_PORT: env.redisPort(),
    DB_CONNECTION_STRING: z.string().min(1),
    PROBLEM_ADMIN_SERVICE_URL: env.url().default("http://localhost:3001"),
    SOCKET_SERVICE_URL: env.url().default("http://localhost:3005"),
  }),
  { serviceName: "submission-service" },
);
