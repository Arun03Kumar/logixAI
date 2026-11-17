const { DEFAULT_TOKEN_ISSUER } = require("@logixai/contracts");
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
    IDENTITY_JWKS_URL: env
      .url()
      .default("http://localhost:3006/.well-known/jwks.json"),
    JWT_ISSUER: z.string().default(DEFAULT_TOKEN_ISSUER),
    /** Shared secret submission-service sends to /sendPayload. Required in production. */
    INTERNAL_API_TOKEN: z.string().optional(),
  }),
  { serviceName: "socket-service" },
);
