import { Redis } from "ioredis";

export interface RedisOptions {
  host: string;
  port: number;
  /** Required in production (Redis holds queued submissions). */
  password?: string;
  /** Use TLS (managed Redis services usually require it). */
  tls?: boolean;
}

/**
 * Creates an ioredis connection. `maxRetriesPerRequest: null` is required by
 * BullMQ for connections used by workers, and harmless for plain usage.
 */
export function createRedisConnection(options: RedisOptions): Redis {
  return new Redis({
    host: options.host,
    port: options.port,
    ...(options.password ? { password: options.password } : {}),
    ...(options.tls ? { tls: {} } : {}),
    maxRetriesPerRequest: null,
  });
}
