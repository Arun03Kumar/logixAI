const { createAccessTokenVerifier } = require("@logixai/service-kit");
const {
  createSubmission,
} = require("../../../controllers/submissionController");
const {
  IDENTITY_JWKS_URL,
  JWT_ISSUER,
} = require("../../../config/serverConfig");

const verifier = createAccessTokenVerifier({
  jwksUrl: IDENTITY_JWKS_URL,
  issuer: JWT_ISSUER,
});

/** Fastify preHandler: the caller must be signed in. */
async function authenticate(request) {
  request.auth = await verifier.verifyHeader(request.headers.authorization);
}

async function submissionRoutes(fastify, options) {
  fastify.post("/", { preHandler: authenticate }, createSubmission);
}

module.exports = submissionRoutes;
