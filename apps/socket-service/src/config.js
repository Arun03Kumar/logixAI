const { DEFAULT_TOKEN_ISSUER } = require("@logixai/contracts");
const { loadConfig, env, z } = require("@logixai/service-kit");

module.exports = loadConfig(
  z
    .object({
      PORT: env.port(3005),
      NODE_ENV: env.nodeEnv(),
      REDIS_HOST: env.redisHost(),
      REDIS_PORT: env.redisPort(),
      REDIS_PASSWORD: env.redisPassword(),
      REDIS_TLS: env.flag(false),
      CORS_ORIGINS: env.list([
        "http://localhost:3008",
        "http://localhost:4000",
        "http://localhost:5500",
      ]),
      IDENTITY_JWKS_URL: env
        .url()
        .default("http://localhost:3006/.well-known/jwks.json"),
      JWT_ISSUER: z.string().default(DEFAULT_TOKEN_ISSUER),
      /** Shared secret submission-service sends to /sendPayload. */
      INTERNAL_API_TOKEN: z.string().optional(),
    })
    .refine((c) => c.NODE_ENV !== "production" || Boolean(c.INTERNAL_API_TOKEN), {
      message: "INTERNAL_API_TOKEN is required in production",
      path: ["INTERNAL_API_TOKEN"],
    })
    .refine((c) => c.NODE_ENV !== "production" || Boolean(c.REDIS_PASSWORD), {
      message: "REDIS_PASSWORD is required in production",
      path: ["REDIS_PASSWORD"],
    }),
  { serviceName: "socket-service" },
);
