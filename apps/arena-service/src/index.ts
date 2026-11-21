import path from "node:path";
import { fileURLToPath } from "node:url";
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
} from "@logixai/service-kit";
import { buildApp } from "./app.js";
import { config } from "./config.js";
import { loadCatalog } from "./content/catalog.js";
import { createQueueJudge, startJudgeResultWorker } from "./judge.js";
import { createHttpIdentityClient } from "./lib/identity.js";
import { createResultHub } from "./lib/resultHub.js";
import { createMongoStore } from "./store/mongoStore.js";

const logger = createLogger("arena-service");
export const CONTENT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "content");

async function start() {
  try {
    // Fails fast on invalid content or tests that are out of date.
    const catalog = loadCatalog(CONTENT_DIR);
    logger.info(`Loaded ${catalog.tracks.length} tracks, ${catalog.items.length} items`);

    await connectMongo(config.DB_CONNECTION_STRING, logger, {
      // Production indexes are built by `npm run db:migrate`, not at startup.
      autoIndex: config.NODE_ENV !== "production",
      appName: "arena-service",
    });
    const redis = createRedisConnection({
      host: config.REDIS_HOST,
      port: config.REDIS_PORT,
      ...(config.REDIS_PASSWORD ? { password: config.REDIS_PASSWORD } : {}),
      tls: config.REDIS_TLS,
    });

    // Separate, fail-fast connection: a Redis outage lets requests through instead of hanging them.
    const limitsRedis = createRedisConnection({
      host: config.REDIS_HOST,
      port: config.REDIS_PORT,
      ...(config.REDIS_PASSWORD ? { password: config.REDIS_PASSWORD } : {}),
      tls: config.REDIS_TLS,
      failFast: true,
    });

    // Judge results reach open result streams on any replica (a subscriber connection is dedicated).
    const resultHub = createResultHub(
      redis,
      createRedisConnection({
        host: config.REDIS_HOST,
        port: config.REDIS_PORT,
        ...(config.REDIS_PASSWORD ? { password: config.REDIS_PASSWORD } : {}),
        tls: config.REDIS_TLS,
      }),
    );

    const { app, arena } = await buildApp({
      catalog,
      store: createMongoStore(),
      judge: createQueueJudge(redis),
      identity: createHttpIdentityClient(config.IDENTITY_API_URL),
      verifier: createAccessTokenVerifier({ jwksUrl: config.IDENTITY_JWKS_URL, issuer: config.JWT_ISSUER }),
      corsOrigins: config.CORS_ORIGINS,
      codeRunsPerMinute: config.CODE_RUNS_PER_MINUTE,
      rateLimitRedis: limitsRedis,
      resultHub,
      busyBacklog: config.JUDGE_BUSY_BACKLOG,
    });
    const worker = startJudgeResultWorker(redis, arena, logger);
    registerHealthRoutes(app, { mongo: mongoReady, redis: redisReady(redis) });
    onShutdown(
      [
        ["http", () => app.close()],
        ["judge-result-worker", () => worker.close()],
        ["result-hub", () => resultHub.close()],
        closeRedis(redis),
        closeRedis(limitsRedis, "rate-limit redis"),
        closeMongo,
      ],
      { logger },
    );

    await app.listen({ port: config.PORT, host: "0.0.0.0" });
    logger.info(`arena-service listening on port ${config.PORT}`);
  } catch (err) {
    logger.error(`Failed to start arena-service: ${(err as Error).message}`);
    process.exit(1);
  }
}

start();
