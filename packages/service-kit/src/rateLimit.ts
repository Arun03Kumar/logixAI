import type { Redis } from "ioredis";

/**
 * Options for @fastify/rate-limit's store.
 *
 * With Redis, every replica of a service shares the same counters, so a
 * limit of 10 a minute stays 10 a minute however many copies run. Without it
 * (local development, tests) counters live in memory per process.
 *
 * If Redis is unreachable, requests are let through rather than rejected:
 * a broken limiter shouldn't take sign-in or code runs down with it.
 */
export function rateLimitStore(redis: Redis | undefined, service: string) {
  return redis ? { redis, nameSpace: `logixai:rl:${service}:`, skipOnError: true } : {};
}
