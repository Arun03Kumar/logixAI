import { connectMongo, createAccessTokenVerifier, createLogger } from "@logixai/service-kit";
import { buildApp } from "./app.js";
import { config } from "./config.js";
import { createHttpIdentityGateway } from "./lib/identity.js";
import { createMockProvider, createRazorpayProvider } from "./providers/index.js";
import { createMongoStore } from "./store/mongoStore.js";

const logger = createLogger("billing-service");
const SWEEP_EVERY_MS = 60_000;

async function start() {
  try {
    await connectMongo(config.DB_CONNECTION_STRING, logger, {
      autoIndex: config.NODE_ENV !== "production",
      appName: "billing-service",
    });
    const provider =
      config.RAZORPAY_KEY_ID && config.RAZORPAY_KEY_SECRET
        ? createRazorpayProvider({
            keyId: config.RAZORPAY_KEY_ID,
            keySecret: config.RAZORPAY_KEY_SECRET,
            ...(config.RAZORPAY_WEBHOOK_SECRET ? { webhookSecret: config.RAZORPAY_WEBHOOK_SECRET } : {}),
          })
        : createMockProvider();
    if (provider.name === "mock") {
      logger.warn("No Razorpay keys: using the mock checkout. No real payments can be taken.");
    } else if (config.RAZORPAY_KEY_ID?.startsWith("rzp_test_")) {
      logger.info("Razorpay test mode");
    }

    const { app, billing } = await buildApp({
      store: createMongoStore(),
      provider,
      identity: createHttpIdentityGateway(config.IDENTITY_URL, config.INTERNAL_API_TOKEN),
      verifier: createAccessTokenVerifier({ jwksUrl: config.IDENTITY_JWKS_URL, issuer: config.JWT_ISSUER }),
      corsOrigins: config.CORS_ORIGINS,
      logger,
    });

    // Paid orders whose Pro grant failed (identity-service down) are retried.
    setInterval(() => {
      billing
        .sweepUnfulfilled()
        .then((n) => n && logger.info(`Granted Pro for ${n} delayed order(s)`))
        .catch((err) => logger.error(`Fulfilment sweep failed: ${err.message}`));
    }, SWEEP_EVERY_MS);

    await app.listen({ port: config.PORT, host: "0.0.0.0" });
    logger.info(`billing-service listening on port ${config.PORT} (payments: ${provider.name})`);
  } catch (err) {
    logger.error(`Failed to start billing-service: ${(err as Error).message}`);
    process.exit(1);
  }
}

start();
