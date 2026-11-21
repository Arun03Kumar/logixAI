const {
  BadRequestError,
  NotFoundError,
  errorResponse,
} = require("@logixai/service-kit");
const logger = require("../config/logger.config");

/** Turns mongoose errors into the matching HTTP error. */
function normalizeError(err, req) {
  // A malformed id (not a 24-char ObjectId) can never match a document.
  if (err?.name === "CastError" && err.path === "_id") {
    return new NotFoundError("Problem", req.params?.id ?? err.value);
  }
  if (err?.name === "ValidationError") {
    return new BadRequestError("problem", err.errors);
  }
  return err;
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const { statusCode, body } = errorResponse(normalizeError(err, req));
  if (statusCode >= 500) {
    logger.error(err?.stack || String(err));
  }
  // Errors are never cached (public reads set a shared Cache-Control earlier).
  res.set("Cache-Control", "no-store");
  return res.status(statusCode).json(body);
}

module.exports = errorHandler;
