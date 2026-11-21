import mongoose from "mongoose";
import type { Logger } from "./logger";

export interface MongoOptions {
  /**
   * Build indexes automatically when models load. Keep this on in development
   * only: in production indexes are built deliberately by `npm run db:migrate`
   * so a deploy never locks a large collection unexpectedly.
   */
  autoIndex?: boolean;
  /** Shows up in Atlas metrics and logs, so slow queries can be traced to a service. */
  appName?: string;
  /**
   * Connections per service instance. Default: MONGO_MAX_POOL_SIZE, else 20.
   * Budget: replicas × pool size, summed over services on one cluster, must
   * stay under the cluster's connection limit (docs/deploy.md).
   */
  maxPoolSize?: number;
  /** Connections kept open while idle. Default: MONGO_MIN_POOL_SIZE, else 0. */
  minPoolSize?: number;
  /**
   * Extra connection attempts after the first one fails (default 4, with
   * 2 s, 4 s, 8 s, 16 s waits). Covers slow DNS, a cluster that is still
   * starting, or a container that boots before the network is ready.
   */
  retries?: number;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A positive integer from the environment, or undefined when unset/empty/invalid. */
function envInt(name: string) {
  const raw = process.env[name]?.trim();
  const value = Number(raw);
  return raw && Number.isInteger(value) && value >= 0 ? value : undefined;
}

/** Pool settings: explicit options, then MONGO_MAX_POOL_SIZE / MONGO_MIN_POOL_SIZE, then defaults. */
export function poolSettings(options: Pick<MongoOptions, "maxPoolSize" | "minPoolSize"> = {}) {
  const maxPoolSize = options.maxPoolSize ?? envInt("MONGO_MAX_POOL_SIZE") ?? 20;
  const minPoolSize = Math.min(options.minPoolSize ?? envInt("MONGO_MIN_POOL_SIZE") ?? 0, maxPoolSize);
  // Idle connections close after a minute, so quiet replicas give connections back.
  return { maxPoolSize, minPoolSize, maxIdleTimeMS: 60_000 };
}

/**
 * Connects mongoose to MongoDB, retrying with backoff. Throws when every
 * attempt fails so the service can exit instead of serving requests without
 * a database.
 */
export async function connectMongo(
  uri: string,
  logger?: Logger,
  options: MongoOptions = {},
): Promise<typeof mongoose> {
  const retries = options.retries ?? 4;
  for (let attempt = 0; ; attempt++) {
    try {
      const connection = await mongoose.connect(uri, {
        autoIndex: options.autoIndex ?? true,
        ...poolSettings(options),
        serverSelectionTimeoutMS: 15_000,
        ...(options.appName ? { appName: options.appName } : {}),
      });
      logger?.info(`Connected to MongoDB (database "${connection.connection.name}")`);
      return connection;
    } catch (err) {
      if (attempt >= retries) throw err;
      const delay = 2_000 * 2 ** attempt;
      // The message never contains the connection string, so it is safe to log.
      logger?.warn(
        `MongoDB connection failed (${(err as Error).message.slice(0, 120)}); retrying in ${delay / 1000}s`,
      );
      await mongoose.disconnect().catch(() => undefined);
      await wait(delay);
    }
  }
}

export async function disconnectMongo(): Promise<void> {
  await mongoose.disconnect();
}
