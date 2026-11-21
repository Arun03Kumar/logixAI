import { DEFAULT_TOKEN_ISSUER } from "@logixai/contracts";
import { env, loadConfig, z } from "@logixai/service-kit";

/** Empty (as in .env.example) means unset. */
const optionalSecret = () =>
  z
    .string()
    .optional()
    .transform((v) => (v ? v : undefined));

export const config = loadConfig(
  z
    .object({
      PORT: env.port(3011),
      NODE_ENV: env.nodeEnv(),
      DB_CONNECTION_STRING: z.string().min(1).default("mongodb://localhost:27017/logixai-billing"),
      /** identity-service base URL (its /internal routes sit at the root). */
      IDENTITY_URL: env.url().default("http://localhost:3006"),
      IDENTITY_JWKS_URL: env.url().default("http://localhost:3006/.well-known/jwks.json"),
      JWT_ISSUER: z.string().default(DEFAULT_TOKEN_ISSUER),
      /** Shared with identity-service's /internal routes. */
      INTERNAL_API_TOKEN: optionalSecret(),
      /** Razorpay API keys (test keys start rzp_test_). Without them, development uses a mock checkout. */
      RAZORPAY_KEY_ID: optionalSecret(),
      RAZORPAY_KEY_SECRET: optionalSecret(),
      /** Secret set on the Razorpay webhook (Dashboard > Webhooks). */
      RAZORPAY_WEBHOOK_SECRET: optionalSecret(),
      /** "redis" in production with more than one replica, so limits are shared. */
      RATE_LIMIT_STORE: env.rateLimitStore(),
      REDIS_HOST: env.redisHost(),
      REDIS_PORT: env.redisPort(),
      REDIS_PASSWORD: env.redisPassword(),
      REDIS_TLS: env.flag(false),
      CORS_ORIGINS: env.list(["http://localhost:3008"]),
    })
    .refine((c) => c.NODE_ENV !== "production" || Boolean(c.INTERNAL_API_TOKEN), {
      message: "INTERNAL_API_TOKEN is required in production",
      path: ["INTERNAL_API_TOKEN"],
    })
    .refine(
      (c) => c.NODE_ENV !== "production" || Boolean(c.RAZORPAY_KEY_ID && c.RAZORPAY_KEY_SECRET && c.RAZORPAY_WEBHOOK_SECRET),
      { message: "Razorpay keys and webhook secret are required in production", path: ["RAZORPAY_KEY_ID"] },
    )
    .refine((c) => Boolean(c.RAZORPAY_KEY_ID) === Boolean(c.RAZORPAY_KEY_SECRET), {
      message: "Set both RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET, or neither",
      path: ["RAZORPAY_KEY_SECRET"],
    }),
  { serviceName: "billing-service" },
);
