const {
  NotFoundError,
  InternalServerError,
  internalHeaders,
} = require("@logixai/service-kit");
const axiosInstance = require("../config/axiosInstance");
const {
  PROBLEM_ADMIN_SERVICE_URL,
  INTERNAL_API_TOKEN,
} = require("../config/serverConfig");

/**
 * Fetches a problem with its hidden tests and hidden code from
 * problem-service's internal endpoint.
 * Throws NotFoundError when the problem does not exist (or the id is invalid),
 * InternalServerError when problem-service cannot be reached.
 */
async function fetchProblemDetails(problemId) {
  const uri = `${PROBLEM_ADMIN_SERVICE_URL}/api/v1/problems/${encodeURIComponent(problemId)}/judge`;
  try {
    const response = await axiosInstance.get(uri, { headers: internalHeaders(INTERNAL_API_TOKEN) });
    return response.data;
  } catch (error) {
    const status = error.response?.status;
    if (status === 404 || status === 400) {
      throw new NotFoundError("Problem", problemId);
    }
    throw new InternalServerError({
      reason: "Could not fetch problem details",
      cause: error.message,
    });
  }
}

module.exports = fetchProblemDetails;
