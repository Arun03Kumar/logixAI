import { createRedisConnection } from "@logixai/service-kit";
import { REDIS_HOST, REDIS_PORT } from "./serverConfig.js";

const redis = createRedisConnection({ host: REDIS_HOST, port: REDIS_PORT });

export default redis;
