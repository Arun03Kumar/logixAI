const { Worker } = require("bullmq");
const { QUEUE_NAMES, JOB_NAMES } = require("@logixai/contracts");
const redisConnection = require("../config/redisConfig");
const axiosInstance = require("../config/axiosInstance");
const { SOCKET_SERVICE_URL } = require("../config/serverConfig");
const processEvaluation = require("./processEvaluation");

async function notifyUser(userId, payload) {
  await axiosInstance.post(`${SOCKET_SERVICE_URL}/sendPayload`, {
    userId,
    payload,
  });
}

/**
 * Consumes EvaluationQueue: saves each submission's verdict and forwards the
 * result to the browser.
 */
function evaluationWorker(submissionRepository, logger = console) {
  const worker = new Worker(
    QUEUE_NAMES.EVALUATION,
    async (job) => {
      if (job.name !== JOB_NAMES.EVALUATION) return undefined;
      const status = await processEvaluation(job.data, {
        submissionRepository,
        notifyUser,
        logger,
      });
      return { status };
    },
    { connection: redisConnection },
  );

  worker.on("failed", (job, err) => {
    logger.error(`Evaluation job ${job?.id} failed: ${err.message}`);
  });

  return worker;
}

module.exports = evaluationWorker;
