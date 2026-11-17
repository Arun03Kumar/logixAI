const { Queue } = require("bullmq");
const { QUEUE_NAMES } = require("@logixai/contracts");
const redisConnection = require("../config/redisConfig");

module.exports = new Queue(QUEUE_NAMES.SUBMISSION, {
  connection: redisConnection,
});
