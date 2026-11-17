const fastifyPlugin = require("fastify-plugin");
const { errorResponse } = require("@logixai/service-kit");
const servicePlugin = require("./services/servicePlugin");
const repositoryPlugin = require("./repositories/repositoryPlugin");

async function app(fastify, options) {
  fastify.setErrorHandler((err, request, reply) => {
    const { statusCode, body } = errorResponse(err);
    if (statusCode >= 500) {
      request.log.error(err);
    }
    return reply.status(statusCode).send(body);
  });

  await fastify.register(repositoryPlugin);
  await fastify.register(fastifyPlugin(servicePlugin));
  await fastify.register(require("./routes/api/apiRoutes"), { prefix: "/api" });
}

module.exports = fastifyPlugin(app);
