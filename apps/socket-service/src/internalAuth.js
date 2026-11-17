const { timingSafeEqual } = require("crypto");

/** Header carrying the shared secret for service-to-service calls. */
const INTERNAL_TOKEN_HEADER = "x-internal-token";

/**
 * Express middleware for endpoints only other LogixAI services may call.
 * With no token configured (local development) every request is allowed.
 */
function requireInternalToken(expected) {
  return (req, res, next) => {
    if (!expected) return next();
    const given = Buffer.from(String(req.headers[INTERNAL_TOKEN_HEADER] ?? ""));
    const want = Buffer.from(expected);
    if (given.length === want.length && timingSafeEqual(given, want)) {
      return next();
    }
    return res
      .status(401)
      .json({ success: false, message: "Unauthorized", error: {}, data: {} });
  };
}

module.exports = { requireInternalToken, INTERNAL_TOKEN_HEADER };
