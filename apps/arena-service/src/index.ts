import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  connectMongo,
  createAccessTokenVerifier,
  createLogger,
  createRedisConnection,
} from "@logixai/service-kit";
import { buildApp } from "./app.js";
import { config } from "./config.js";
import { loadCatalog } from "./content/catalog.js";
import { createQueueJudge, startJudgeResultWorker } from "./judge.js";
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

    const { app, arena } = await buildApp({
      catalog,
      store: createMongoStore(),
      judge: createQueueJudge(redis),
      verifier: createAccessTokenVerifier({ jwksUrl: config.IDENTITY_JWKS_URL, issuer: config.JWT_ISSUER }),
      corsOrigins: config.CORS_ORIGINS,
      codeRunsPerMinute: config.CODE_RUNS_PER_MINUTE,
    });
    startJudgeResultWorker(redis, arena, logger);

    await app.listen({ port: config.PORT, host: "0.0.0.0" });
    logger.info(`arena-service listening on port ${config.PORT}`);
  } catch (err) {
    logger.error(`Failed to start arena-service: ${(err as Error).message}`);
    process.exit(1);
  }
}

start();
