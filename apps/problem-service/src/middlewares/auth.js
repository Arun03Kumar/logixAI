const { requirePlatformRole } = require("@logixai/service-kit");

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

module.exports = { createRequireAdmin };
