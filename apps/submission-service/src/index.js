const {
  fastifyRequestIdOptions,
  instrumentHttp,
  registerMetricsRoute,
} = require("@logixai/service-kit");
const fastify = require("fastify")({ logger: true, ...fastifyRequestIdOptions });
// Request timing per route (/metrics) and X-Request-Id on every response.
instrumentHttp(fastify, "submission-service", { error: (msg) => fastify.log.error(msg) });
const cors = require("@fastify/cors");
const {
  closeMongo,
  closeRedis,
  mongoReady,
  onShutdown,
  redisReady,
  registerHealthRoutes,
} = require("@logixai/service-kit");
const redis = require("./config/redisConfig");

const app = require("./app");
const connect_db = require("./config/dbConfig");
const { PORT } = require("./config/serverConfig");
const evaluationWorker = require("./workers/evaluationWorker");

async function start() {
  try {
    await fastify.register(cors, { origin: "*" });
    fastify.register(app);

    await connect_db();
    fastify.log.info("db connected");

    registerHealthRoutes(fastify, { mongo: mongoReady, redis: redisReady(redis) });
    registerMetricsRoute(fastify);
    // 0.0.0.0, not the default localhost, so the service is reachable inside a container.
    await fastify.listen({ port: PORT, host: "0.0.0.0" });

    const worker = evaluationWorker(fastify.submissionRepository, fastify.log);
    onShutdown(
      [["http", () => fastify.close()], ["evaluation-worker", () => worker.close()], closeRedis(redis), closeMongo],
      { logger: fastify.log },
    );
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

start();
