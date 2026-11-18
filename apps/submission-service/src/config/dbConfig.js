const { connectMongo } = require("@logixai/service-kit");
const { DB_CONNECTION_STRING, NODE_ENV } = require("./serverConfig");

async function connect_db() {
  await connectMongo(DB_CONNECTION_STRING, undefined, {
    // Production indexes are built by `npm run db:migrate`, not at startup.
    autoIndex: NODE_ENV !== "production",
    appName: "submission-service",
  });
}

module.exports = connect_db;
