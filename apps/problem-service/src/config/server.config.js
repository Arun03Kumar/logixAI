const { DEFAULT_TOKEN_ISSUER } = require("@logixai/contracts");
const { loadConfig, env, z } = require("@logixai/service-kit");

module.exports = loadConfig(
  z
    .object({
      PORT: env.port(3001),
      NODE_ENV: env.nodeEnv(),
      DB_CONNECTION_STRING: z.string().min(1),
      IDENTITY_JWKS_URL: env
        .url()
        .default("http://localhost:3006/.well-known/jwks.json"),
      JWT_ISSUER: z.string().default(DEFAULT_TOKEN_ISSUER),
      /** Shared secret for service-to-service calls (hidden tests endpoint). */
      INTERNAL_API_TOKEN: z.string().optional(),
    })
    .refine((c) => c.NODE_ENV !== "production" || Boolean(c.INTERNAL_API_TOKEN), {
      message: "INTERNAL_API_TOKEN is required in production",
      path: ["INTERNAL_API_TOKEN"],
    }),
  { serviceName: "problem-service" },
);
