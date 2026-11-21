/**
 * `npm run db:migrate`: applies pending data migrations, then builds the
 * indexes declared in the models. Run on every deploy, before starting the
 * new version.
 */
const mongoose = require("mongoose");
const { connectMongo, loadMigrationConfig, runMigrations } = require("@logixai/service-kit");
// Only the database: a migration job doesn't get the service's other settings.
const { DB_CONNECTION_STRING } = loadMigrationConfig("problem-service");
const logger = require("../config/logger.config");
require("../models"); // registers the models whose indexes get synced
const migrations = require("./migrations");

(async () => {
  try {
    await connectMongo(DB_CONNECTION_STRING, logger, { autoIndex: false, appName: "problem-service-migrate" });
    await runMigrations({ connection: mongoose.connection, migrations, logger });
    await mongoose.disconnect();
  } catch (err) {
    logger.error(`Migration failed: ${err.message}`);
    process.exit(1);
  }
})();
