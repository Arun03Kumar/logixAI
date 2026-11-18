const {
  INTERNAL_TOKEN_HEADER,
  isInternalRequest,
  requirePlatformRole,
} = require("@logixai/service-kit");

/**
 * Express middleware: only platform admins may change the problem catalogue.
 * @param verifier AccessTokenVerifier from @logixai/service-kit
 */
function createRequireAdmin(verifier) {
  return async function requireAdmin(req, res, next) {
    try {
      const claims = await verifier.verifyHeader(req.headers.authorization);
      requirePlatformRole(claims, "admin");
      req.auth = claims;
      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Express middleware for data containing hidden tests: other LogixAI services
 * (shared INTERNAL_API_TOKEN) or platform admins.
 */
function createRequireInternalOrAdmin(verifier, internalToken) {
  const requireAdmin = createRequireAdmin(verifier);
  return function requireInternalOrAdmin(req, res, next) {
    if (req.headers[INTERNAL_TOKEN_HEADER] !== undefined || !req.headers.authorization) {
      if (isInternalRequest(internalToken, req.headers[INTERNAL_TOKEN_HEADER])) return next();
    }
    return requireAdmin(req, res, next);
  };
}

module.exports = { createRequireAdmin, createRequireInternalOrAdmin };
