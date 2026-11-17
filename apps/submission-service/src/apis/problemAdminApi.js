const {
  NotFoundError,
  InternalServerError,
} = require("@logixai/service-kit");
const axiosInstance = require("../config/axiosInstance");
const { PROBLEM_ADMIN_SERVICE_URL } = require("../config/serverConfig");

/**
 * Fetches a problem from problem-service.
 * Throws NotFoundError when the problem does not exist (or the id is invalid),
 * InternalServerError when problem-service cannot be reached.
 */
async function fetchProblemDetails(problemId) {
  const uri = `${PROBLEM_ADMIN_SERVICE_URL}/api/v1/problems/${encodeURIComponent(problemId)}`;
  try {
    const response = await axiosInstance.get(uri);
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
