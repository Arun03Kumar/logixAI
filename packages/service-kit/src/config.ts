import dotenv from "dotenv";
import { z } from "zod";

/** Reusable env fields so every service parses them the same way. */
export const env = {
  port: (fallback: number) => z.coerce.number().int().positive().default(fallback),
  nodeEnv: () =>
    z.enum(["development", "test", "production"]).default("development"),
  redisHost: () => z.string().min(1).default("127.0.0.1"),
  redisPort: () => z.coerce.number().int().positive().default(6379),
  url: () => z.url(),
  /** Comma-separated list, e.g. "http://localhost:3008,http://localhost:4000" */
  list: (fallback: string[]) =>
    z
      .string()
      .optional()
      .transform((value) =>
        value
          ? value
              .split(",")
              .map((item) => item.trim())
              .filter(Boolean)
          : fallback,
      ),
};

/**
 * Loads `.env` from the working directory, validates `process.env` against the
 * schema and returns a typed, frozen config object.
 *
 * On invalid config it prints every problem and exits, so a service never
 * starts half-configured.
 */
export function loadConfig<S extends z.ZodObject>(
  schema: S,
  options: { serviceName?: string; exitOnError?: boolean } = {},
): Readonly<z.infer<S>> {
  dotenv.config({ quiet: true });

  const result = schema.safeParse(process.env);
  if (!result.success) {
    const name = options.serviceName ?? "service";
    const problems = result.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    const message = `[${name}] Invalid environment configuration:\n${problems}`;

    if (options.exitOnError === false) {
      throw new Error(message);
    }
    console.error(message);
    process.exit(1);
  }

  return Object.freeze(result.data);
}
