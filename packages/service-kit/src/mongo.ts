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
  /** Connections per service instance. */
  maxPoolSize?: number;
  /**
   * Extra connection attempts after the first one fails (default 4, with
   * 2 s, 4 s, 8 s, 16 s waits). Covers slow DNS, a cluster that is still
   * starting, or a container that boots before the network is ready.
   */
  retries?: number;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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
        maxPoolSize: options.maxPoolSize ?? 20,
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
