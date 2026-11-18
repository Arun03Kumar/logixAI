import type mongoose from "mongoose";
import type { Logger } from "./logger";

type Db = mongoose.mongo.Db;

/** One data change. `id` is permanent: never rename or reorder applied migrations. */
export interface Migration {
  /** e.g. "2026-11-18-legacy-problem-samples" — sorted order is apply order */
  id: string;
  description: string;
  up(db: Db): Promise<void>;
}

const APPLIED = "_migrations";
const LOCK = "_migrations_lock";
/** A lock older than this is assumed to belong to a crashed run. */
const STALE_LOCK_MS = 10 * 60 * 1000;

async function acquireLock(db: Db): Promise<void> {
  const locks = db.collection<{ _id: string; lockedAt: Date }>(LOCK);
  try {
    await locks.insertOne({ _id: "lock", lockedAt: new Date() });
  } catch (err) {
    if ((err as { code?: number }).code !== 11000) throw err;
    const taken = await locks.findOneAndUpdate(
      { _id: "lock", lockedAt: { $lt: new Date(Date.now() - STALE_LOCK_MS) } },
      { $set: { lockedAt: new Date() } },
    );
    if (!taken) {
      throw new Error("Another migration run holds the lock. Try again when it finishes.");
    }
  }
}

/**
 * Applies pending migrations in id order, once each, under a lock so two
 * deploys can't run them at the same time. Then makes every model's indexes
 * match the schema (creating missing ones, dropping ones no longer defined).
 *
 * Returns the ids applied in this run.
 */
export async function runMigrations(options: {
  connection: mongoose.Connection;
  migrations: Migration[];
  logger?: Logger;
  /** Sync indexes of all registered models afterwards (default true). */
  syncIndexes?: boolean;
}): Promise<string[]> {
  const db = options.connection.db;
  if (!db) throw new Error("Not connected to MongoDB");
  const log = (msg: string) => options.logger?.info(msg) ?? console.log(msg);

  const ids = options.migrations.map((m) => m.id);
  if (new Set(ids).size !== ids.length) throw new Error("Duplicate migration ids");

  await acquireLock(db);
  const applied: string[] = [];
  try {
    const done = new Set(
      (await db.collection<{ _id: string }>(APPLIED).find({}, { projection: { _id: 1 } }).toArray()).map(
        (d) => d._id,
      ),
    );
    for (const migration of [...options.migrations].sort((a, b) => a.id.localeCompare(b.id))) {
      if (done.has(migration.id)) continue;
      log(`Applying migration ${migration.id}: ${migration.description}`);
      await migration.up(db);
      await db
        .collection<{ _id: string; description: string; appliedAt: Date }>(APPLIED)
        .insertOne({ _id: migration.id, description: migration.description, appliedAt: new Date() });
      applied.push(migration.id);
    }

    if (options.syncIndexes !== false) {
      for (const model of Object.values(options.connection.models)) {
        const dropped = await model.syncIndexes();
        await model.createCollection().catch(() => {});
        log(`Indexes in sync for ${model.collection.collectionName}${dropped.length ? ` (dropped ${dropped.join(", ")})` : ""}`);
      }
    }
  } finally {
    await db.collection(LOCK).deleteOne({ _id: "lock" as never });
  }
  log(applied.length ? `Applied ${applied.length} migration(s)` : "No pending migrations");
  return applied;
}
