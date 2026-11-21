import { Redis } from "ioredis";

export interface RedisOptions {
  host: string;
  port: number;
  /** Required in production (Redis holds queued submissions). */
  password?: string;
  /** Use TLS (managed Redis services usually require it). */
  tls?: boolean;
  /**
   * Fail commands quickly while Redis is unreachable instead of queueing them
   * until it comes back. Use for request-path helpers such as rate limits,
   * never for BullMQ queues and workers.
   */
  failFast?: boolean;
}

/**
 * Creates an ioredis connection. By default `maxRetriesPerRequest: null`, which
 * BullMQ requires for workers: commands wait (forever) for Redis to return.
 */
export function createRedisConnection(options: RedisOptions): Redis {
  return new Redis({
    host: options.host,
    port: options.port,
    ...(options.password ? { password: options.password } : {}),
    ...(options.tls ? { tls: {} } : {}),
    // failFast keeps the offline queue (so commands sent while the connection is
    // still opening wait for it), but gives up on any command after 500 ms.
    ...(options.failFast
      ? { maxRetriesPerRequest: 1, commandTimeout: 500, connectTimeout: 2_000 }
      : { maxRetriesPerRequest: null }),
  });
}
