const { DEFAULT_TOKEN_ISSUER } = require("@logixai/contracts");
const { loadConfig, env, z } = require("@logixai/service-kit");

module.exports = loadConfig(
  z.object({
    PORT: env.port(3001),
    NODE_ENV: env.nodeEnv(),
    DB_CONNECTION_STRING: z.string().min(1),
    IDENTITY_JWKS_URL: env
      .url()
      .default("http://localhost:3006/.well-known/jwks.json"),
    JWT_ISSUER: z.string().default(DEFAULT_TOKEN_ISSUER),
  }),
  { serviceName: "problem-service" },
);
