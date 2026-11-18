import { createRedisConnection } from "@logixai/service-kit";
import { REDIS_HOST, REDIS_PASSWORD, REDIS_PORT, REDIS_TLS } from "./serverConfig.js";

const redis = createRedisConnection({
  host: REDIS_HOST,
  port: REDIS_PORT,
  ...(REDIS_PASSWORD ? { password: REDIS_PASSWORD } : {}),
  tls: REDIS_TLS,
});

export default redis;
