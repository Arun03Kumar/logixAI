const { connectMongo } = require("@logixai/service-kit");
const { DB_CONNECTION_STRING, NODE_ENV } = require("./server.config");
const logger = require("./logger.config");

async function connect_db() {
  await connectMongo(DB_CONNECTION_STRING, logger, {
    // Production indexes are built by `npm run db:migrate`, not at startup.
    autoIndex: NODE_ENV !== "production",
    appName: "problem-service",
  });
}

module.exports = connect_db;
