const { connectMongo } = require("@logixai/service-kit");
const { DB_CONNECTION_STRING } = require("./server.config");
const logger = require("./logger.config");

async function connect_db() {
  await connectMongo(DB_CONNECTION_STRING, logger);
}

module.exports = connect_db;
