import mongoose, { Schema, Types } from "mongoose";
import type { PracticeStore, ProfileRecord, SessionRecord } from "./types.js";

const outcomeSchema = new Schema(
  { solvedAt: { type: Date, default: null }, wrong: { type: Number, default: 0 }, revealed: { type: Boolean, default: false } },
  { _id: false },
);

const sessionSchema = new Schema(
  {
    userId: { type: String, required: true },
    kind: { type: String, enum: ["mock", "contest"], required: true },
    sourceId: { type: String, required: true },
    title: { type: String, required: true },
    itemIds: { type: [String], required: true },
    startedAt: { type: Date, required: true },
    endsAt: { type: Date, required: true },
    finishedAt: { type: Date, default: null },
    ranked: { type: Boolean, default: false },
    scoreFrom: { type: Date, required: true },
    displayName: { type: String, required: true },
    // itemId -> outcome. Item ids are slugs (no dots), so they're safe as keys.
    outcomes: { type: Map, of: outcomeSchema, default: {} },
  },
  { collection: "practice_sessions", versionKey: false, minimize: false },
);
// A learner's history and open sessions.
sessionSchema.index({ userId: 1, startedAt: -1 });
// Leaderboards and "my entry" for a contest.
sessionSchema.index({ sourceId: 1, ranked: 1 });
const Session = mongoose.model("PracticeSession", sessionSchema);

const profileSchema = new Schema(
  {
    userId: { type: String, required: true, unique: true },
    handle: { type: String, required: true, unique: true },
    displayName: { type: String, required: true },
    bio: { type: String, default: "" },
    public: { type: Boolean, default: false },
    createdAt: { type: Date, required: true },
  },
  { collection: "profiles", versionKey: false },
);
const Profile = mongoose.model("Profile", profileSchema);

type LeanSession = Omit<SessionRecord, "id" | "outcomes"> & { _id: Types.ObjectId; outcomes?: Record<string, SessionRecord["outcomes"][string]> };

function session(doc: LeanSession | null): SessionRecord | null {
  if (!doc) return null;
  const { _id, outcomes, ...rest } = doc;
  return { ...rest, id: String(_id), outcomes: { ...(outcomes ?? {}) } };
}

function profile(doc: (ProfileRecord & { _id?: unknown }) | null): ProfileRecord | null {
  if (!doc) return null;
  const { _id: _ignored, ...rest } = doc;
  return rest as ProfileRecord;
}

const isId = (v: string) => Types.ObjectId.isValid(v);

export function createPracticeMongoStore(): PracticeStore {
  return {
    sessions: {
      create: async (data) => {
        const doc = await Session.create(data);
        return session(doc.toObject({ flattenMaps: true }) as unknown as LeanSession)!;
      },
      get: async (id) => (isId(id) ? session(await Session.findById(id).lean<LeanSession>({ flattenMaps: true })) : null),
      listForUser: async (userId, limit) =>
        (await Session.find({ userId }).sort({ startedAt: -1 }).limit(limit).lean<LeanSession[]>({ flattenMaps: true })).map((d) => session(d)!),
      findOpen: async (userId, now) =>
        (await Session.find({ userId, finishedAt: null, endsAt: { $gt: now } }).lean<LeanSession[]>({ flattenMaps: true })).map((d) => session(d)!),
      recordOutcome: async (id, itemId, event, at) => {
        if (!isId(id)) return;
        const path = `outcomes.${itemId}`;
        // Make sure the outcome exists, then update it only while unsolved.
        await Session.updateOne(
          { _id: id, [path]: { $exists: false } },
          { $set: { [path]: { solvedAt: null, wrong: 0, revealed: false } } },
        );
        const update =
          event === "correct"
            ? { $set: { [`${path}.solvedAt`]: at } }
            : event === "wrong"
              ? { $inc: { [`${path}.wrong`]: 1 } }
              : { $set: { [`${path}.revealed`]: true } };
        await Session.updateOne({ _id: id, [`${path}.solvedAt`]: null }, update);
      },
      finish: async (id, at) => {
        if (isId(id)) await Session.updateOne({ _id: id, finishedAt: null }, { $set: { finishedAt: at } });
      },
      listForSource: async (sourceId, rankedOnly) =>
        (await Session.find({ sourceId, ...(rankedOnly ? { ranked: true } : {}) }).lean<LeanSession[]>({ flattenMaps: true })).map(
          (d) => session(d)!,
        ),
      latestForUserAndSource: async (userId, sourceId) =>
        session(await Session.findOne({ userId, sourceId }).sort({ startedAt: -1 }).lean<LeanSession>({ flattenMaps: true })),
      countSince: (userId, kind, since) => Session.countDocuments({ userId, kind, startedAt: { $gte: since } }),
    },
    profiles: {
      get: async (userId) => profile(await Profile.findOne({ userId }).lean<ProfileRecord>()),
      getByHandle: async (handle) => profile(await Profile.findOne({ handle }).lean<ProfileRecord>()),
      getMany: async (userIds) => (await Profile.find({ userId: { $in: userIds } }).lean<ProfileRecord[]>()).map((d) => profile(d)!),
      upsert: async (data, at) =>
        profile(
          await Profile.findOneAndUpdate(
            { userId: data.userId },
            { $set: { handle: data.handle, displayName: data.displayName, bio: data.bio, public: data.public }, $setOnInsert: { createdAt: at } },
            { upsert: true, new: true },
          ).lean<ProfileRecord>(),
        )!,
    },
  };
}
