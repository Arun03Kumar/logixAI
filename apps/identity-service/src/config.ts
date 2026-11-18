import { DEFAULT_TOKEN_ISSUER } from "@logixai/contracts";
import { env, loadConfig, z } from "@logixai/service-kit";

export const config = loadConfig(
  z
    .object({
      PORT: env.port(3006),
      NODE_ENV: env.nodeEnv(),
      DB_CONNECTION_STRING: z
        .string()
        .min(1)
        .default("mongodb://localhost:27017/logixai-identity"),
      /** PKCS8 PEM (EdDSA / Ed25519). Required in production; generated per run in development. */
      JWT_PRIVATE_KEY: z.string().optional(),
      JWT_KEY_ID: z.string().default("logixai-1"),
      JWT_ISSUER: z.string().default(DEFAULT_TOKEN_ISSUER),
      ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).default(900),
      REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).default(30),
      CORS_ORIGINS: env.list(["http://localhost:3008"]),
      /** Accounts created with these emails get the platform `admin` role. */
      BOOTSTRAP_ADMIN_EMAILS: env.list([]),
      /** Shared secret for /internal routes (billing-service grants Pro). Required in production. */
      INTERNAL_API_TOKEN: z
        .string()
        .optional()
        .transform((v) => (v ? v : undefined))
        .refine((v) => !v || v.length >= 16, "Use at least 16 characters"),
    })
    .refine((c) => c.NODE_ENV !== "production" || Boolean(c.JWT_PRIVATE_KEY), {
      message: "JWT_PRIVATE_KEY is required in production",
      path: ["JWT_PRIVATE_KEY"],
    })
    .refine((c) => c.NODE_ENV !== "production" || Boolean(c.INTERNAL_API_TOKEN), {
      message: "INTERNAL_API_TOKEN is required in production",
      path: ["INTERNAL_API_TOKEN"],
    }),
  { serviceName: "identity-service" },
);

export type Config = typeof config;
