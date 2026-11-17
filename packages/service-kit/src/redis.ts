import { Redis } from "ioredis";

export interface RedisOptions {
  host: string;
  port: number;
}

/**
 * Creates an ioredis connection. `maxRetriesPerRequest: null` is required by
 * BullMQ for connections used by workers, and harmless for plain usage.
 */
export function createRedisConnection(options: RedisOptions): Redis {
  return new Redis({
    host: options.host,
    port: options.port,
    maxRetriesPerRequest: null,
  });
}
