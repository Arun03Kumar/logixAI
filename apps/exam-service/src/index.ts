import {
  closeMongo,
  closeRedis,
  connectMongo,
  createAccessTokenVerifier,
  createLogger,
  createRedisConnection,
  mongoReady,
  onShutdown,
  redisReady,
  registerHealthRoutes,
  registerMetricsRoute,
} from "@logixai/service-kit";
import { config } from "./config.js";
import { buildApp } from "./app.js";
import { createQueueJudge, startJudgeResultWorker } from "./judge.js";
import { createHttpIdentityClient } from "./lib/identity.js";
import { createMongoStore } from "./store/mongoStore.js";

const logger = createLogger("exam-service");
const SWEEP_EVERY_MS = 30_000;

async function start() {
  try {
    await connectMongo(config.DB_CONNECTION_STRING, logger, {
      // Production indexes are built by `npm run db:migrate`, not at startup.
      autoIndex: config.NODE_ENV !== "production",
      appName: "exam-service",
    });
    const redis = createRedisConnection({
      host: config.REDIS_HOST,
      port: config.REDIS_PORT,
      ...(config.REDIS_PASSWORD ? { password: config.REDIS_PASSWORD } : {}),
      tls: config.REDIS_TLS,
    });

    const { app, attempts } = await buildApp({
      store: createMongoStore(),
      identity: createHttpIdentityClient(config.IDENTITY_API_URL),
      judge: createQueueJudge(redis),
      verifier: createAccessTokenVerifier({
        jwksUrl: config.IDENTITY_JWKS_URL,
        issuer: config.JWT_ISSUER,
      }),
      corsOrigins: config.CORS_ORIGINS,
    });

    const worker = startJudgeResultWorker(redis, attempts, logger);

    // Auto-submit attempts whose time ran out while the student was away.
    const sweep = setInterval(() => {
      attempts
        .sweepExpired()
        .then((n) => n && logger.info(`Auto-submitted ${n} expired attempt(s)`))
        .catch((err) => logger.error(`Expired-attempt sweep failed: ${err.message}`));
    }, SWEEP_EVERY_MS);

    registerHealthRoutes(app, { mongo: mongoReady, redis: redisReady(redis) });

    registerMetricsRoute(app);
    onShutdown(
      [
        ["sweep", () => clearInterval(sweep)],
        ["http", () => app.close()],
        ["judge-result-worker", () => worker.close()],
        closeRedis(redis),
        closeMongo,
      ],
      { logger },
    );

    await app.listen({ port: config.PORT, host: "0.0.0.0" });
    logger.info(`exam-service listening on port ${config.PORT}`);
  } catch (err) {
    logger.error(`Failed to start exam-service: ${(err as Error).message}`);
    process.exit(1);
  }
}

start();
