import { Queue } from "bullmq";
import { QUEUE_NAMES } from "@logixai/contracts";
import redis from "../config/redisConfig.js";

export default new Queue(QUEUE_NAMES.SUBMISSION, { connection: redis });
