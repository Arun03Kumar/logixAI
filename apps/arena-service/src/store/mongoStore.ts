import mongoose, { Schema, Types } from "mongoose";
import { AUDIT_ACTIONS, type AuditEvent } from "@logixai/contracts";
import { decodeCursor, toPage } from "@logixai/service-kit";
import type { AssignmentRecord, ProgressRecord, StatsRecord, Store, SubmissionRecord } from "./types.js";

const progressSchema = new Schema(
  {
    userId: { type: String, required: true },
    itemId: { type: String, required: true },
    status: { type: String, enum: ["attempted", "solved", "revealed"], required: true },
    attempts: { type: Number, default: 0 },
    lastAnswer: { type: Schema.Types.Mixed, default: null },
    xp: { type: Number, default: 0 },
    solvedAt: { type: Date, default: null },
    revealedAt: { type: Date, default: null },
    lastActivityAt: { type: Date, required: true },
    review: {
      type: new Schema({ due: { type: Date, required: true }, intervalDays: { type: Number, required: true } }, { _id: false }),
      default: null,
    },
  },
  { collection: "item_progress", versionKey: false, minimize: false },
);
// Also serves batch reports: { userId: { $in }, itemId: { $in } }.
progressSchema.index({ userId: 1, itemId: 1 }, { unique: true });
const Progress = mongoose.model("ItemProgress", progressSchema);

const testResultSchema = new Schema(
  {
    index: Number,
    sample: Boolean,
    verdict: String,
    timeMs: Number,
    call: String,
    expected: String,
    output: String,
    message: String,
  },
  { _id: false },
);

const submissionSchema = new Schema(
  {
    userId: { type: String, required: true },
    itemId: { type: String, required: true },
    mode: { type: String, enum: ["run", "submit"], required: true },
    code: { type: String, required: true },
    status: { type: String, enum: ["pending", "passed", "failed", "error"], required: true },
    passed: { type: Number, default: 0 },
    total: { type: Number, default: 0 },
    tests: { type: [testResultSchema], default: [] },
    xpGained: { type: Number, default: 0 },
    createdAt: { type: Date, required: true },
    judgedAt: { type: Date, default: null },
  },
  { collection: "submissions", versionKey: false },
);
// History pages (all, or for one item), newest first.
submissionSchema.index({ userId: 1, _id: -1 });
submissionSchema.index({ userId: 1, itemId: 1, _id: -1 });
// Dashboard acceptance rate and the "one pending run at a time" check.
submissionSchema.index({ userId: 1, mode: 1, status: 1 });
const Submission = mongoose.model("ArenaSubmission", submissionSchema);

const statsSchema = new Schema(
  {
    userId: { type: String, required: true, unique: true },
    xp: { type: Number, default: 0 },
    solvedCount: { type: Number, default: 0 },
    days: { type: Schema.Types.Mixed, default: {} },
  },
  { collection: "user_stats", versionKey: false, minimize: false },
);
const Stats = mongoose.model("UserStats", statsSchema);

const assignmentSchema = new Schema(
  {
    institutionId: { type: String, required: true },
    batchId: { type: String, required: true },
    trackId: { type: String, required: true },
    dueAt: { type: Date, default: null },
    assignedBy: { type: String, required: true },
    createdAt: { type: Date, required: true },
  },
  { collection: "track_assignments", versionKey: false },
);
assignmentSchema.index({ institutionId: 1, batchId: 1, trackId: 1 }, { unique: true });
const Assignment = mongoose.model("TrackAssignment", assignmentSchema);

const auditSchema = new Schema(
  {
    at: { type: Date, required: true, default: () => new Date() },
    actorId: { type: String, required: true },
    action: { type: String, enum: AUDIT_ACTIONS, required: true },
    institutionId: { type: String, default: null },
    targetType: { type: String, required: true },
    targetId: { type: String, required: true },
    meta: { type: Schema.Types.Mixed, default: {} },
  },
  { collection: "audit_events", versionKey: false, minimize: false },
);
auditSchema.index({ institutionId: 1, _id: -1 });
const AuditEventModel = mongoose.model("AuditEvent", auditSchema);

const assignment = (doc: Lean<Omit<AssignmentRecord, "id">> | null): AssignmentRecord | null =>
  doc ? ({ ...strip(doc)!, id: String(doc._id) } as AssignmentRecord) : null;

type Lean<T> = T & { _id: Types.ObjectId };
const strip = <T>(doc: Lean<T> | null): T | null => {
  if (!doc) return null;
  const { _id: _ignored, ...rest } = doc;
  return rest as T;
};
const sub = (doc: Lean<Omit<SubmissionRecord, "id">> | null): SubmissionRecord | null =>
  doc ? ({ ...strip(doc)!, id: String(doc._id) } as SubmissionRecord) : null;
const isId = (v: unknown): v is string => typeof v === "string" && Types.ObjectId.isValid(v);

export function createMongoStore(): Store {
  return {
    progress: {
      get: async (userId, itemId) => strip(await Progress.findOne({ userId, itemId }).lean<Lean<ProgressRecord>>()),
      listForUser: async (userId) =>
        (await Progress.find({ userId }).lean<Lean<ProgressRecord>[]>()).map((d) => strip(d)!),
      recordAttempt: async (userId, itemId, lastAnswer, at) =>
        strip(
          await Progress.findOneAndUpdate(
            { userId, itemId },
            {
              $inc: { attempts: 1 },
              $set: { lastAnswer, lastActivityAt: at },
              $setOnInsert: { status: "attempted", xp: 0, solvedAt: null, revealedAt: null },
            },
            { upsert: true, new: true },
          ).lean<Lean<ProgressRecord>>(),
        )!,
      markSolved: async (userId, itemId, xp, at) => {
        const before = await Progress.findOneAndUpdate(
          { userId, itemId, status: { $ne: "solved" } },
          { $set: { status: "solved", xp, solvedAt: at, lastActivityAt: at } },
        ).lean<Lean<ProgressRecord>>();
        if (before) return before.status;
        // No unsolved row: either already solved, or there's no row yet.
        try {
          await Progress.create({ userId, itemId, status: "solved", attempts: 1, xp, solvedAt: at, lastActivityAt: at });
          return null;
        } catch (err) {
          if ((err as { code?: number }).code === 11000) return "solved";
          throw err;
        }
      },
      markRevealed: async (userId, itemId, at) => {
        const res = await Progress.updateOne(
          { userId, itemId, status: { $ne: "solved" } },
          {
            $set: { status: "revealed", revealedAt: at, lastActivityAt: at },
            $setOnInsert: { attempts: 0, xp: 0, solvedAt: null, lastAnswer: null },
          },
          { upsert: true },
        ).catch((err: { code?: number }) => {
          if (err.code === 11000) return { matchedCount: 0, upsertedCount: 0 };
          throw err;
        });
        return res.matchedCount + res.upsertedCount > 0;
      },
      setReview: async (userId, itemId, review) => {
        await Progress.updateOne({ userId, itemId }, { $set: { review } });
      },
      listForUsers: async (userIds, itemIds) =>
        (await Progress.find({ userId: { $in: userIds }, itemId: { $in: itemIds } }).lean<Lean<ProgressRecord>[]>()).map(
          (d) => strip(d)!,
        ),
    },
    submissions: {
      create: async (data) => sub((await Submission.create(data)).toObject() as never)!,
      get: async (id) => (isId(id) ? sub(await Submission.findById(id).lean<Lean<Omit<SubmissionRecord, "id">>>()) : null),
      complete: async (id, result) =>
        sub(
          await Submission.findOneAndUpdate({ _id: id, status: "pending" }, { $set: result }, { new: true }).lean<
            Lean<Omit<SubmissionRecord, "id">>
          >(),
        ),
      setXp: async (id, xp) => {
        await Submission.updateOne({ _id: id }, { $set: { xpGained: xp } });
      },
      pageForUser: async (userId, { limit, cursor, itemId }) => {
        const after = decodeCursor(cursor, isId);
        const docs = await Submission.find(
          {
            userId,
            ...(itemId ? { itemId } : {}),
            ...(after ? { _id: { $lt: new Types.ObjectId(after) } } : {}),
          },
          { code: 0 },
        )
          .sort({ _id: -1 })
          .limit(limit + 1)
          .lean<Lean<Omit<SubmissionRecord, "id">>[]>();
        const page = toPage(docs, limit, (last) => String(last._id));
        return { items: page.items.map((d) => sub(d)!), nextCursor: page.nextCursor };
      },
      countPendingSince: (userId, since) =>
        Submission.countDocuments({ userId, status: "pending", createdAt: { $gt: since } }),
      submitStats: async (userId) => {
        const [total, passed] = await Promise.all([
          Submission.countDocuments({ userId, mode: "submit", status: { $ne: "pending" } }),
          Submission.countDocuments({ userId, mode: "submit", status: "passed" }),
        ]);
        return { total, passed };
      },
    },
    stats: {
      get: async (userId) => strip(await Stats.findOne({ userId }).lean<Lean<StatsRecord>>()),
      record: async (userId, day, change) => {
        await Stats.updateOne(
          { userId },
          { $inc: { xp: change.xp, solvedCount: change.solved, [`days.${day}`]: change.solved } },
          { upsert: true },
        );
      },
      getMany: async (userIds) =>
        (await Stats.find({ userId: { $in: userIds } }).lean<Lean<StatsRecord>[]>()).map((d) => strip(d)!),
    },
    assignments: {
      create: async (data) => assignment((await Assignment.create(data)).toObject() as never)!,
      get: async (id) => (isId(id) ? assignment(await Assignment.findById(id).lean<Lean<Omit<AssignmentRecord, "id">>>()) : null),
      delete: async (id) => {
        await Assignment.deleteOne({ _id: id });
      },
      listForInstitution: async (institutionId, batchIds) =>
        (
          await Assignment.find({ institutionId, ...(batchIds ? { batchId: { $in: batchIds } } : {}) })
            .sort({ createdAt: -1 })
            .lean<Lean<Omit<AssignmentRecord, "id">>[]>()
        ).map((d) => assignment(d)!),
    },
    audit: {
      record: async (event) => {
        await AuditEventModel.create(event);
      },
      pageForInstitution: async (institutionId, { limit, cursor }) => {
        const after = decodeCursor(cursor, isId);
        const docs = await AuditEventModel.find({
          institutionId,
          ...(after ? { _id: { $lt: new Types.ObjectId(after) } } : {}),
        })
          .sort({ _id: -1 })
          .limit(limit + 1)
          .lean();
        const page = toPage(docs, limit, (last) => String(last._id));
        return {
          items: page.items.map(({ _id, at, ...rest }) => ({
            ...(rest as Omit<AuditEvent, "id" | "at">),
            id: String(_id),
            at: at.toISOString(),
          })),
          nextCursor: page.nextCursor,
        };
      },
    },
  };
}
