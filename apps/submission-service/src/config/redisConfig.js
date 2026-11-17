const { createRedisConnection } = require("@logixai/service-kit");
const { REDIS_HOST, REDIS_PORT } = require("./serverConfig");

module.exports = createRedisConnection({ host: REDIS_HOST, port: REDIS_PORT });
