/**
 * `npm run db:migrate`: applies pending data migrations, then builds the
 * indexes declared in the models. Run on every deploy, before starting the
 * new version.
 */
import mongoose from "mongoose";
import { connectMongo, createLogger, runMigrations } from "@logixai/service-kit";
import { config } from "../config.js";
import "../store/mongoStore.js"; // registers the models
import { migrations } from "./migrations.js";

const logger = createLogger("identity-service");

try {
  await connectMongo(config.DB_CONNECTION_STRING, logger, {
    autoIndex: false,
    appName: "identity-service-migrate",
  });
  await runMigrations({ connection: mongoose.connection, migrations, logger });
  await mongoose.disconnect();
} catch (err) {
  logger.error(`Migration failed: ${(err as Error).message}`);
  process.exit(1);
}
