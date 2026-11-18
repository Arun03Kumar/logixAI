import { DEFAULT_TOKEN_ISSUER } from "@logixai/contracts";
import { env, loadConfig, z } from "@logixai/service-kit";

export const config = loadConfig(
  z.object({
    PORT: env.port(3007),
    NODE_ENV: env.nodeEnv(),
    DB_CONNECTION_STRING: z
      .string()
      .min(1)
      .default("mongodb://localhost:27017/logixai-exams"),
    REDIS_HOST: env.redisHost(),
    REDIS_PORT: env.redisPort(),
    REDIS_PASSWORD: env.redisPassword(),
    REDIS_TLS: env.flag(false),
    /** identity-service API, used to check the caller's institution role. */
    IDENTITY_API_URL: env.url().default("http://localhost:3006/api/v1"),
    IDENTITY_JWKS_URL: env.url().default("http://localhost:3006/.well-known/jwks.json"),
    JWT_ISSUER: z.string().default(DEFAULT_TOKEN_ISSUER),
    CORS_ORIGINS: env.list(["http://localhost:3008"]),
  })
  .refine((c) => c.NODE_ENV !== "production" || Boolean(c.REDIS_PASSWORD), {
    message: "REDIS_PASSWORD is required in production",
    path: ["REDIS_PASSWORD"],
  }),
  { serviceName: "exam-service" },
);
