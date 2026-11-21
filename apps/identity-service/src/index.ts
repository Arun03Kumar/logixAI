import {
  closeMongo,
  closeRedis,
  connectMongo,
  createLogger,
  createRedisConnection,
  mongoReady,
  onShutdown,
  registerHealthRoutes,
  registerMetricsRoute,
} from "@logixai/service-kit";
import { config } from "./config.js";
import { buildApp } from "./app.js";
import { createTokenIssuer } from "./lib/tokens.js";
import { createMongoStore } from "./store/mongoStore.js";

const logger = createLogger("identity-service");

async function start() {
  try {
    await connectMongo(config.DB_CONNECTION_STRING, logger, {
      // Production indexes are built by `npm run db:migrate`, not at startup.
      autoIndex: config.NODE_ENV !== "production",
      appName: "identity-service",
    });

    if (!config.JWT_PRIVATE_KEY) {
      logger.warn(
        "JWT_PRIVATE_KEY not set: using a temporary signing key. Sessions refresh automatically after a restart.",
      );
    }
    const tokens = await createTokenIssuer({
      ...(config.JWT_PRIVATE_KEY ? { privateKeyPem: config.JWT_PRIVATE_KEY } : {}),
      keyId: config.JWT_KEY_ID,
      issuer: config.JWT_ISSUER,
      accessTokenTtlSeconds: config.ACCESS_TOKEN_TTL_SECONDS,
    });

    // Shared rate-limit counters when RATE_LIMIT_STORE=redis (fail-fast: an outage lets requests through).
    const limitsRedis =
      config.RATE_LIMIT_STORE === "redis"
        ? createRedisConnection({
            host: config.REDIS_HOST,
            port: config.REDIS_PORT,
            ...(config.REDIS_PASSWORD ? { password: config.REDIS_PASSWORD } : {}),
            tls: config.REDIS_TLS,
            failFast: true,
          })
        : undefined;

    const app = await buildApp({
      store: createMongoStore(),
      tokens,
      issuer: config.JWT_ISSUER,
      corsOrigins: config.CORS_ORIGINS,
      secureCookies: config.NODE_ENV === "production",
      refreshTokenTtlDays: config.REFRESH_TOKEN_TTL_DAYS,
      refreshCookiePath: config.REFRESH_COOKIE_PATH,
      authRateLimit: config.AUTH_RATE_LIMIT_PER_MINUTE,
      adminEmails: config.BOOTSTRAP_ADMIN_EMAILS,
      ...(config.INTERNAL_API_TOKEN ? { internalToken: config.INTERNAL_API_TOKEN } : {}),
      ...(limitsRedis ? { rateLimitRedis: limitsRedis } : {}),
    });

    registerHealthRoutes(app, { mongo: mongoReady });

    registerMetricsRoute(app);
    onShutdown([["http", () => app.close()], ...(limitsRedis ? [closeRedis(limitsRedis)] : []), closeMongo], { logger });

    await app.listen({ port: config.PORT, host: "0.0.0.0" });
    logger.info(`identity-service listening on port ${config.PORT}`);
  } catch (err) {
    logger.error(`Failed to start identity-service: ${(err as Error).message}`);
    process.exit(1);
  }
}

start();
