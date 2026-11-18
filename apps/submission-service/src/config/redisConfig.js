const { createRedisConnection } = require("@logixai/service-kit");
const { REDIS_HOST, REDIS_PORT, REDIS_PASSWORD, REDIS_TLS } = require("./serverConfig");

module.exports = createRedisConnection({
  host: REDIS_HOST,
  port: REDIS_PORT,
  password: REDIS_PASSWORD,
  tls: REDIS_TLS,
});
