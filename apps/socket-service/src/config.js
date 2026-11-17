const { loadConfig, env, z } = require("@logixai/service-kit");

module.exports = loadConfig(
  z.object({
    PORT: env.port(3005),
    NODE_ENV: env.nodeEnv(),
    REDIS_HOST: env.redisHost(),
    REDIS_PORT: env.redisPort(),
    CORS_ORIGINS: env.list([
      "http://localhost:3008",
      "http://localhost:4000",
      "http://localhost:5500",
    ]),
  }),
  { serviceName: "socket-service" },
);
