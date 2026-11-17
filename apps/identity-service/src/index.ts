import { connectMongo, createLogger } from "@logixai/service-kit";
import { config } from "./config.js";
import { buildApp } from "./app.js";
import { createTokenIssuer } from "./lib/tokens.js";
import { createMongoStore } from "./store/mongoStore.js";

const logger = createLogger("identity-service");

async function start() {
  try {
    await connectMongo(config.DB_CONNECTION_STRING, logger);

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

    const app = await buildApp({
      store: createMongoStore(),
      tokens,
      issuer: config.JWT_ISSUER,
      corsOrigins: config.CORS_ORIGINS,
      secureCookies: config.NODE_ENV === "production",
      refreshTokenTtlDays: config.REFRESH_TOKEN_TTL_DAYS,
      adminEmails: config.BOOTSTRAP_ADMIN_EMAILS,
    });

    await app.listen({ port: config.PORT, host: "0.0.0.0" });
    logger.info(`identity-service listening on port ${config.PORT}`);
  } catch (err) {
    logger.error(`Failed to start identity-service: ${(err as Error).message}`);
    process.exit(1);
  }
}

start();
