const { connectMongo } = require("@logixai/service-kit");
const { DB_CONNECTION_STRING } = require("./serverConfig");

async function connect_db() {
  await connectMongo(DB_CONNECTION_STRING);
}

module.exports = connect_db;
