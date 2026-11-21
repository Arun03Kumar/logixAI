/**
 * `npm run db:migrate`: applies pending data migrations, then syncs the
 * indexes declared in the models. Run on every deploy, before starting the
 * new version.
 */
import mongoose from "mongoose";
import { loadMigrationConfig, connectMongo, createLogger, runMigrations, type Migration } from "@logixai/service-kit";
import "../store/mongoStore.js"; // registers the models

// Only the database: a migration job doesn't get the service's other settings.
const config = loadMigrationConfig("billing-service");

/** Add new migrations at the end. Never edit one that has already run. */
const migrations: Migration[] = [];

const logger = createLogger("billing-service");

try {
  await connectMongo(config.DB_CONNECTION_STRING, logger, { autoIndex: false, appName: "billing-service-migrate" });
  await runMigrations({ connection: mongoose.connection, migrations, logger });
  await mongoose.disconnect();
} catch (err) {
  logger.error(`Migration failed: ${(err as Error).message}`);
  process.exit(1);
}
