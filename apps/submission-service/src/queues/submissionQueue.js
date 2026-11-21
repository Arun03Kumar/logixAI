const { Queue } = require("bullmq");
const { judgeQueueFor } = require("@logixai/contracts");
const redisConnection = require("../config/redisConfig");

/** One BullMQ queue per judge queue name (DSA languages share one). */
const queues = new Map();

/** The judge queue for a submission in `language`. */
function judgeQueue(language) {
  const name = judgeQueueFor(language);
  if (!queues.has(name)) queues.set(name, new Queue(name, { connection: redisConnection }));
  return queues.get(name);
}

module.exports = { judgeQueue };
