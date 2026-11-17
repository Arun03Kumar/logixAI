const { loadConfig, env, z } = require("@logixai/service-kit");

module.exports = loadConfig(
  z.object({
    PORT: env.port(3001),
    NODE_ENV: env.nodeEnv(),
    DB_CONNECTION_STRING: z.string().min(1),
  }),
  { serviceName: "problem-service" },
);
