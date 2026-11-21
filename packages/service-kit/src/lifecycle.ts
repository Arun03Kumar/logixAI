import mongoose from "mongoose";
import type { Redis } from "ioredis";

/**
 * Health checks and graceful shutdown, shared by every service.
 *
 * - `GET /healthz` (liveness): the process is up. Orchestrators restart the
 *   container when it fails.
 * - `GET /readyz` (readiness): dependencies are reachable and the service is
 *   not shutting down. Load balancers stop routing to it when it fails.
 *
 * On SIGTERM / SIGINT the service first reports "not ready" for
 * `drainMs` (so load balancers stop sending new requests), then closes the
 * HTTP server, queue workers and connections in the given order, and exits.
 */

export type ReadinessCheck = () => boolean | Promise<boolean>;

interface MinimalLogger {
  info: (msg: string) => unknown;
  warn: (msg: string) => unknown;
  error: (msg: string) => unknown;
}

let shuttingDown = false;

/** True once SIGTERM / SIGINT was received. */
export const isShuttingDown = () => shuttingDown;

/** MongoDB (mongoose default connection) is connected. */
export const mongoReady: ReadinessCheck = () => mongoose.connection.readyState === 1;

/** An ioredis connection is ready. */
export const redisReady =
  (redis: Pick<Redis, "status">): ReadinessCheck =>
  () =>
    redis.status === "ready";

export async function readiness(checks: Record<string, ReadinessCheck>) {
  const results: Record<string, boolean> = {};
  await Promise.all(
    Object.entries(checks).map(async ([name, check]) => {
      try {
        results[name] = Boolean(await check());
      } catch {
        results[name] = false;
      }
    }),
  );
  const ok = !shuttingDown && Object.values(results).every(Boolean);
  return { ok, status: shuttingDown ? "shutting-down" : ok ? "ready" : "not-ready", checks: results };
}

/**
 * Adds `/healthz` and `/readyz` to a Fastify or Express app (before listen).
 * Both answer JSON and are never rate limited or authenticated.
 */
export function registerHealthRoutes(
  app: { get: (path: string, handler: (req: unknown, res: any) => unknown) => unknown },
  checks: Record<string, ReadinessCheck> = {},
) {
  const send = (res: any, code: number, body: unknown) =>
    typeof res.code === "function" ? res.code(code).send(body) : res.status(code).json(body);

  app.get("/healthz", (_req, res) => send(res, 200, { status: "ok" }));
  app.get("/readyz", async (_req, res) => {
    const result = await readiness(checks);
    return send(res, result.ok ? 200 : 503, result);
  });
}

export type ShutdownStep = [name: string, close: () => unknown];

export interface ShutdownOptions {
  logger: MinimalLogger;
  /** Time to keep running while reporting "not ready". Default: SHUTDOWN_DRAIN_MS, else 5 s in production, 0 otherwise. */
  drainMs?: number;
  /** Hard limit for all close steps; the process exits with code 1 after it. Default 25 s. */
  timeoutMs?: number;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function defaultDrainMs() {
  const raw = process.env.SHUTDOWN_DRAIN_MS?.trim();
  const fromEnv = Number(raw);
  if (raw && Number.isFinite(fromEnv) && fromEnv >= 0) return fromEnv;
  return process.env.NODE_ENV === "production" ? 5_000 : 0;
}

/**
 * Runs `steps` in order on SIGTERM / SIGINT, then exits. Typical order: stop
 * timers, close the HTTP server (finishes in-flight requests), close queue
 * workers (finishes the current job), then Redis and MongoDB.
 */
export function onShutdown(steps: ShutdownStep[], options: ShutdownOptions) {
  const { logger } = options;
  const drainMs = options.drainMs ?? defaultDrainMs();
  const timeoutMs = options.timeoutMs ?? 25_000;

  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`${signal} received: draining for ${drainMs} ms, then shutting down`);
    const timer = setTimeout(() => {
      logger.error(`Shutdown took longer than ${timeoutMs} ms; exiting`);
      process.exit(1);
    }, drainMs + timeoutMs);
    timer.unref();

    await wait(drainMs);
    let failed = false;
    for (const [name, close] of steps) {
      try {
        await close();
      } catch (err) {
        failed = true;
        logger.warn(`Shutdown step "${name}" failed: ${(err as Error).message}`);
      }
    }
    logger.info("Shutdown complete");
    process.exit(failed ? 1 : 0);
  };

  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));
}

/** Close step for mongoose. */
export const closeMongo: ShutdownStep = ["mongodb", () => mongoose.disconnect()];

/** Close step for an ioredis connection. */
export const closeRedis = (redis: Pick<Redis, "quit">, name = "redis"): ShutdownStep => [name, () => redis.quit()];
