import mongoose from "mongoose";
import type { Logger } from "./logger";

/**
 * Connects mongoose to MongoDB. Throws when the connection fails so the
 * service can exit instead of serving requests without a database.
 */
export async function connectMongo(
  uri: string,
  logger?: Logger,
): Promise<typeof mongoose> {
  const connection = await mongoose.connect(uri);
  logger?.info("Connected to MongoDB");
  return connection;
}

export async function disconnectMongo(): Promise<void> {
  await mongoose.disconnect();
}
