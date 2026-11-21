/**
 * `npm run db:migrate`: applies pending data migrations, then builds the
 * indexes declared in the models. Run on every deploy, before starting the
 * new version.
 */
const mongoose = require("mongoose");
const { connectMongo, createLogger, loadMigrationConfig, runMigrations } = require("@logixai/service-kit");
// Only the database: a migration job doesn't get the service's other settings.
const { DB_CONNECTION_STRING } = loadMigrationConfig("submission-service");
require("../models/submissionModel"); // registers the model whose indexes get synced
const migrations = require("./migrations");

const logger = createLogger("submission-service");

(async () => {
  try {
    await connectMongo(DB_CONNECTION_STRING, logger, { autoIndex: false, appName: "submission-service-migrate" });
    await runMigrations({ connection: mongoose.connection, migrations, logger });
    await mongoose.disconnect();
  } catch (err) {
    logger.error(`Migration failed: ${err.message}`);
    process.exit(1);
  }
})();
