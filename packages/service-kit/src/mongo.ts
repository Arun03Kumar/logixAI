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
}

/**
 * Connects mongoose to MongoDB. Throws when the connection fails so the
 * service can exit instead of serving requests without a database.
 */
export async function connectMongo(
  uri: string,
  logger?: Logger,
  options: MongoOptions = {},
): Promise<typeof mongoose> {
  const connection = await mongoose.connect(uri, {
    autoIndex: options.autoIndex ?? true,
    maxPoolSize: options.maxPoolSize ?? 20,
    serverSelectionTimeoutMS: 15_000,
    ...(options.appName ? { appName: options.appName } : {}),
  });
  logger?.info(`Connected to MongoDB (database "${connection.connection.name}")`);
  return connection;
}

export async function disconnectMongo(): Promise<void> {
  await mongoose.disconnect();
}
