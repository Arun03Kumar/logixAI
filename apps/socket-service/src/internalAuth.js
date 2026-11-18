const { isInternalRequest, INTERNAL_TOKEN_HEADER } = require("@logixai/service-kit");

/**
 * Express middleware for endpoints only other LogixAI services may call.
 * With no token configured (local development) every request is allowed.
 */
function requireInternalToken(expected) {
  return (req, res, next) => {
    if (isInternalRequest(expected, req.headers[INTERNAL_TOKEN_HEADER])) return next();
    return res
      .status(401)
      .json({ success: false, message: "Unauthorized", error: {}, data: {} });
  };
}

module.exports = { requireInternalToken, INTERNAL_TOKEN_HEADER };
