import mongoose, { Schema, Types } from "mongoose";
import {
  AUDIT_ACTIONS,
  INSTITUTION_ROLES,
  INSTITUTION_TYPES,
  INVITE_ROLES,
  INSTITUTION_STATUSES,
  JOIN_REQUEST_STATUSES,
  PRICING_MODELS,
  PLATFORM_ROLES,
} from "@logixai/contracts";
import { decodeCursor, toPage } from "@logixai/service-kit";
import { ROLE_RANK, type Store } from "./types.js";

const opts = { timestamps: { createdAt: true, updatedAt: true } } as const;

const User = mongoose.model(
  "User",
  new Schema(
    {
      name: { type: String, required: true },
      // Accounts created for students without email have none (see the partial unique index below).
      email: { type: String, default: null, lowercase: true, trim: true },
      passwordHash: { type: String, required: true },
      role: { type: String, enum: PLATFORM_ROLES, default: "user" },
      managedBy: { type: String, default: null },
      mustChangePassword: { type: Boolean, default: false },
      proUntil: { type: Date, default: null },
      lastSeenAt: { type: Date, default: null },
    },
    opts,
  ).index({ email: 1 }, { unique: true, partialFilterExpression: { email: { $type: "string" } } }),
);

const RefreshToken = mongoose.model(
  "RefreshToken",
  new Schema(
    {
      userId: { type: String, required: true, index: true },
      tokenHash: { type: String, required: true, unique: true },
      // TTL index: Mongo deletes the record once it has expired.
      expiresAt: { type: Date, required: true, index: { expires: 0 } },
      revokedAt: { type: Date, default: null },
    },
    opts,
  ),
);

const Institution = mongoose.model(
  "Institution",
  new Schema(
    {
      name: { type: String, required: true },
      slug: { type: String, required: true, unique: true },
      type: { type: String, enum: INSTITUTION_TYPES, required: true },
      createdBy: { type: String, required: true },
      licenceUntil: { type: Date, default: null },
      licenceSeats: { type: Number, default: null },
      status: { type: String, enum: INSTITUTION_STATUSES, default: "active" },
      features: { type: Schema.Types.Mixed, default: {} },
      contract: {
        type: new Schema(
          {
            model: { type: String, enum: PRICING_MODELS, required: true },
            seats: { type: Number, default: null },
            pricePaise: { type: Number, required: true },
            startsAt: { type: Date, required: true },
            endsAt: { type: Date, required: true },
            notes: { type: String, default: "" },
            updatedAt: { type: Date, required: true },
          },
          { _id: false },
        ),
        default: null,
      },
      emailDomains: { type: [String], default: [], index: true },
    },
    opts,
  ),
);

const membershipSchema = new Schema(
  {
    userId: { type: String, required: true },
    institutionId: { type: String, required: true },
    role: { type: String, enum: INSTITUTION_ROLES, required: true },
    /** Derived from role (owner 6 … student 1) so members list owners first, in the database. */
    roleRank: { type: Number, required: true },
    batchIds: { type: [String], default: [] },
    departmentIds: { type: [String], default: [] },
    rollNumber: { type: String, default: null },
  },
  opts,
);
// Roll-number sign-in and import matching; unique within an institution.
membershipSchema.index(
  { institutionId: 1, rollNumber: 1 },
  { unique: true, partialFilterExpression: { rollNumber: { $type: "string" } } },
);
// One membership per user per institution; also serves "my institutions".
membershipSchema.index({ userId: 1, institutionId: 1 }, { unique: true });
// Members list: highest role first, then join order (keyset on roleRank + _id).
membershipSchema.index({ institutionId: 1, roleRank: -1, _id: 1 });
// Batch member counts.
membershipSchema.index({ institutionId: 1, batchIds: 1 });
const Membership = mongoose.model("Membership", membershipSchema);

const caseInsensitive = { locale: "en", strength: 2 };
const batchSchema = new Schema(
  {
    institutionId: { type: String, required: true },
    name: { type: String, required: true },
    departmentId: { type: String, default: null },
    academicYear: { type: String, default: null },
    archivedAt: { type: Date, default: null },
  },
  opts,
);
// "CSE 2026" and "cse 2026" are the same batch.
batchSchema.index({ institutionId: 1, name: 1 }, { unique: true, collation: caseInsensitive });
const Batch = mongoose.model("Batch", batchSchema);

const departmentSchema = new Schema(
  {
    institutionId: { type: String, required: true },
    name: { type: String, required: true },
    code: { type: String, default: "" },
  },
  opts,
);
departmentSchema.index({ institutionId: 1, name: 1 }, { unique: true, collation: caseInsensitive });
const Department = mongoose.model("Department", departmentSchema);

const inviteSchema = new Schema(
  {
    institutionId: { type: String, required: true },
    code: { type: String, required: true, unique: true },
    role: { type: String, enum: INVITE_ROLES, required: true },
    email: { type: String, default: null },
    batchId: { type: String, default: null },
    maxUses: { type: Number, default: null },
    uses: { type: Number, default: 0 },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    createdBy: { type: String, required: true },
    requiresApproval: { type: Boolean, default: false },
  },
  opts,
);
inviteSchema.index({ institutionId: 1, createdAt: -1 });
const Invite = mongoose.model("Invite", inviteSchema);

const joinRequestSchema = new Schema(
  {
    institutionId: { type: String, required: true },
    userId: { type: String, required: true },
    role: { type: String, enum: INSTITUTION_ROLES, required: true },
    batchId: { type: String, default: null },
    rollNumber: { type: String, default: null },
    source: { type: String, enum: ["invite", "domain"], required: true },
    inviteId: { type: String, default: null },
    status: { type: String, enum: JOIN_REQUEST_STATUSES, default: "pending" },
    decidedBy: { type: String, default: null },
    decidedAt: { type: Date, default: null },
  },
  { ...opts, collection: "join_requests" },
);
// One pending request per person per institution.
joinRequestSchema.index({ institutionId: 1, userId: 1 }, { unique: true, partialFilterExpression: { status: "pending" } });
// Approvals queue, newest first.
joinRequestSchema.index({ institutionId: 1, status: 1, _id: -1 });
joinRequestSchema.index({ userId: 1, status: 1 });
const JoinRequest = mongoose.model("JoinRequest", joinRequestSchema);

/** One row per Pro grant (order, trial, admin); the unique reference makes grants idempotent. */
const EntitlementGrant = mongoose.model(
  "EntitlementGrant",
  new Schema(
    {
      reference: { type: String, required: true, unique: true },
      userId: { type: String, required: true, index: true },
      days: { type: Number, required: true },
      source: { type: String, required: true },
      at: { type: Date, required: true },
    },
    { collection: "entitlement_grants", versionKey: false },
  ),
);

const DAY_MS = 24 * 60 * 60 * 1000;
/** Admin search treats the query as plain text, not a regex. */
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

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
auditSchema.index({ actorId: 1, _id: -1 });
const AuditEventModel = mongoose.model("AuditEvent", auditSchema);

type MembershipCursor = [number, string];
const isMembershipCursor = (v: unknown): v is MembershipCursor =>
  Array.isArray(v) && typeof v[0] === "number" && typeof v[1] === "string" && Types.ObjectId.isValid(v[1]);
const isIdCursor = (v: unknown): v is string => typeof v === "string" && Types.ObjectId.isValid(v);

/** Mongo document -> plain record with a string `id`. */
function rec<T>(doc: unknown): T {
  const { _id, __v: _v, updatedAt: _u, ...rest } = (doc as { toObject(): Record<string, unknown> }).toObject();
  return { id: String(_id), ...rest } as T;
}
const recOrNull = <T>(doc: unknown): T | null => (doc ? rec<T>(doc) : null);
const recs = <T>(docs: unknown[]): T[] => docs.map((d) => rec<T>(d));
const isId = (id: string) => Types.ObjectId.isValid(id);

export function createMongoStore(): Store {
  return {
    users: {
      create: async (data) => rec(await User.create(data)),
      findById: async (id) => (isId(id) ? recOrNull(await User.findById(id)) : null),
      findByEmail: async (email) => (email ? recOrNull(await User.findOne({ email })) : null),
      findByIds: async (ids) => recs(await User.find({ _id: { $in: ids.filter(isId) } })),
      findByEmails: async (emails) => (emails.length ? recs(await User.find({ email: { $in: emails } })) : []),
      update: async (id, patch) =>
        isId(id) ? recOrNull(await User.findByIdAndUpdate(id, { $set: patch }, { new: true })) : null,
      touchLastSeen: async (userId, at) => {
        if (isId(userId)) await User.updateOne({ _id: userId }, { $set: { lastSeenAt: at } });
      },
      extendPro: async (userId, days, now) => {
        if (!isId(userId)) return null;
        // Pipeline update: new end = max(now, current end) + days, in one atomic write.
        const doc = await User.findByIdAndUpdate(
          userId,
          [{ $set: { proUntil: { $add: [{ $max: [{ $ifNull: ["$proUntil", now] }, now] }, days * DAY_MS] } } }],
          { new: true },
        );
        return (doc?.get("proUntil") as Date | null) ?? null;
      },
    },
    entitlements: {
      recordGrant: async (grant) => {
        try {
          await EntitlementGrant.create(grant);
          return true;
        } catch (err) {
          if ((err as { code?: number }).code === 11000) return false;
          throw err;
        }
      },
    },
    refreshTokens: {
      create: async (data) => rec(await RefreshToken.create(data)),
      findByHash: async (tokenHash) => recOrNull(await RefreshToken.findOne({ tokenHash })),
      revoke: async (id) => {
        const res = await RefreshToken.updateOne(
          { _id: id, revokedAt: null },
          { revokedAt: new Date() },
        );
        return res.modifiedCount === 1;
      },
      revokeAllForUser: async (userId) => {
        await RefreshToken.updateMany({ userId, revokedAt: null }, { revokedAt: new Date() });
      },
    },
    institutions: {
      create: async (data) => rec(await Institution.create(data)),
      findById: async (id) => (isId(id) ? recOrNull(await Institution.findById(id)) : null),
      findByIds: async (ids) => recs(await Institution.find({ _id: { $in: ids.filter(isId) } })),
      slugExists: async (slug) => Boolean(await Institution.exists({ slug })),
      findBySlug: async (slug) => recOrNull(await Institution.findOne({ slug })),
      findByEmailDomain: async (domain) => recs(await Institution.find({ emailDomains: domain, status: "active" }).limit(20)),
      setLicence: async (id, until, seats) =>
        isId(id)
          ? recOrNull(await Institution.findByIdAndUpdate(id, { $set: { licenceUntil: until, licenceSeats: seats } }, { new: true }))
          : null,
      update: async (id, patch) =>
        isId(id) ? recOrNull(await Institution.findByIdAndUpdate(id, { $set: patch }, { new: true })) : null,
      search: async (query, limit) => {
        const filter = query
          ? { $or: [{ name: new RegExp(escapeRegex(query), "i") }, { slug: new RegExp(escapeRegex(query), "i") }] }
          : {};
        return recs(await Institution.find(filter).sort({ createdAt: -1 }).limit(limit));
      },
    },
    memberships: {
      create: async (data) => rec(await Membership.create({ ...data, roleRank: ROLE_RANK[data.role] })),
      find: async (userId, institutionId) =>
        recOrNull(await Membership.findOne({ userId, institutionId })),
      findByRollNumber: async (institutionId, rollNumber) => recOrNull(await Membership.findOne({ institutionId, rollNumber })),
      findByRollNumbers: async (institutionId, rollNumbers) =>
        rollNumbers.length ? recs(await Membership.find({ institutionId, rollNumber: { $in: rollNumbers } })) : [],
      findForUsers: async (institutionId, userIds) =>
        userIds.length ? recs(await Membership.find({ institutionId, userId: { $in: userIds } })) : [],
      listForUser: async (userId) => recs(await Membership.find({ userId }).sort({ createdAt: 1 })),
      countForInstitutions: async (institutionIds) => {
        const rows = await Membership.aggregate<{ _id: string; n: number }>([
          { $match: { institutionId: { $in: institutionIds } } },
          { $group: { _id: "$institutionId", n: { $sum: 1 } } },
        ]);
        return Object.fromEntries(rows.map((r) => [r._id, r.n]));
      },
      roleCounts: async (institutionIds) => {
        const rows = await Membership.aggregate<{ _id: { i: string; r: string }; n: number }>([
          { $match: { institutionId: { $in: institutionIds } } },
          { $group: { _id: { i: "$institutionId", r: "$role" }, n: { $sum: 1 } } },
        ]);
        const out: Record<string, Record<string, number>> = {};
        for (const row of rows) (out[row._id.i] ??= {})[row._id.r] = row.n;
        return out;
      },
      activeSince: async (institutionIds, since) => {
        const rows = await Membership.aggregate<{ _id: string; n: number }>([
          { $match: { institutionId: { $in: institutionIds } } },
          {
            $lookup: {
              from: "users",
              let: { uid: { $toObjectId: "$userId" } },
              pipeline: [{ $match: { $expr: { $and: [{ $eq: ["$_id", "$$uid"] }, { $gte: ["$lastSeenAt", since] }] } } }],
              as: "active",
            },
          },
          { $match: { "active.0": { $exists: true } } },
          { $group: { _id: "$institutionId", n: { $sum: 1 } } },
        ]);
        return Object.fromEntries(rows.map((r) => [r._id, r.n]));
      },
      pageForInstitution: async (institutionId, { limit, cursor, role, userIds, batchId, batchIds }) => {
        const after = decodeCursor(cursor, isMembershipCursor);
        const filter: Record<string, unknown> = { institutionId };
        if (role) filter.role = role;
        if (userIds) filter.userId = { $in: userIds };
        if (batchId) filter.batchIds = batchId;
        else if (batchIds) filter.batchIds = { $in: batchIds };
        if (after) {
          const [rank, id] = after;
          filter.$or = [
            { roleRank: { $lt: rank } },
            { roleRank: rank, _id: { $gt: new Types.ObjectId(id) } },
          ];
        }
        const docs = await Membership.find(filter).sort({ roleRank: -1, _id: 1 }).limit(limit + 1);
        const page = toPage(docs, limit, (last) => [last.roleRank, String(last._id)]);
        return { items: recs(page.items), nextCursor: page.nextCursor };
      },
      countByBatch: async (institutionId) => {
        const rows = await Membership.aggregate<{ _id: string; count: number }>([
          { $match: { institutionId } },
          { $unwind: "$batchIds" },
          { $group: { _id: "$batchIds", count: { $sum: 1 } } },
        ]);
        return Object.fromEntries(rows.map((r) => [r._id, r.count]));
      },
      update: async (id, patch) =>
        recOrNull(
          await Membership.findByIdAndUpdate(
            id,
            { ...patch, ...(patch.role ? { roleRank: ROLE_RANK[patch.role] } : {}) },
            { new: true },
          ),
        ),
      addBatch: async (id, batchId) => {
        await Membership.updateOne({ _id: id }, { $addToSet: { batchIds: batchId } });
      },
      delete: async (id) => {
        await Membership.deleteOne({ _id: id });
      },
      countByRole: (institutionId, role) => Membership.countDocuments({ institutionId, role }),
      countSeatedStudents: (institutionId, archived) =>
        Membership.countDocuments({
          institutionId,
          role: "student",
          $or: [{ batchIds: { $size: 0 } }, { batchIds: { $elemMatch: { $nin: archived } } }],
        }),
      moveBatch: async (institutionId, from, to, userIds) => {
        const filter = { institutionId, role: "student", batchIds: from, ...(userIds ? { userId: { $in: userIds } } : {}) };
        const ids = (await Membership.find(filter, { _id: 1 })).map((d) => d._id);
        if (!ids.length) return 0;
        await Membership.updateMany({ _id: { $in: ids } }, { $addToSet: { batchIds: to } });
        await Membership.updateMany({ _id: { $in: ids } }, { $pull: { batchIds: from } });
        return ids.length;
      },
    },
    batches: {
      create: async (data) => rec(await Batch.create(data)),
      findById: async (id) => (isId(id) ? recOrNull(await Batch.findById(id)) : null),
      findByName: async (institutionId, name) =>
        recOrNull(
          await Batch.findOne({ institutionId, name }).collation({ locale: "en", strength: 2 }),
        ),
      listForInstitution: async (institutionId) =>
        recs(await Batch.find({ institutionId }).sort({ name: 1 })),
      update: async (id, patch) =>
        isId(id) ? recOrNull(await Batch.findByIdAndUpdate(id, { $set: patch }, { new: true })) : null,
    },
    departments: {
      create: async (data) => rec(await Department.create(data)),
      findById: async (id) => (isId(id) ? recOrNull(await Department.findById(id)) : null),
      listForInstitution: async (institutionId) =>
        recs(await Department.find({ institutionId }).collation({ locale: "en", strength: 2 }).sort({ name: 1 })),
      update: async (id, patch) =>
        isId(id) ? recOrNull(await Department.findByIdAndUpdate(id, { $set: patch }, { new: true })) : null,
      delete: async (id) => {
        await Department.deleteOne({ _id: id });
      },
    },
    invites: {
      create: async (data) => rec(await Invite.create(data)),
      findById: async (id) => (isId(id) ? recOrNull(await Invite.findById(id)) : null),
      findByCode: async (code) => recOrNull(await Invite.findOne({ code })),
      listForInstitution: async (institutionId) =>
        recs(await Invite.find({ institutionId }).sort({ createdAt: -1 })),
      consumeUse: async (id) => {
        const res = await Invite.updateOne(
          {
            _id: id,
            $or: [{ maxUses: null }, { $expr: { $lt: ["$uses", "$maxUses"] } }],
          },
          { $inc: { uses: 1 } },
        );
        return res.modifiedCount === 1;
      },
      revoke: async (id) => {
        await Invite.updateOne({ _id: id }, { revokedAt: new Date() });
      },
    },
    joinRequests: {
      create: async (data) => rec(await JoinRequest.create(data)),
      findById: async (id) => (isId(id) ? recOrNull(await JoinRequest.findById(id)) : null),
      listForInstitution: async (institutionId, status, limit) =>
        recs(await JoinRequest.find({ institutionId, status }).sort({ _id: -1 }).limit(limit)),
      pendingForUser: async (userId) => recs(await JoinRequest.find({ userId, status: "pending" })),
      decide: async (id, status, by, at) =>
        isId(id)
          ? recOrNull(
              await JoinRequest.findOneAndUpdate(
                { _id: id, status: "pending" },
                { $set: { status, decidedBy: by, decidedAt: at } },
                { new: true },
              ),
            )
          : null,
    },
    audit: {
      record: async (event) => {
        await AuditEventModel.create(event);
      },
      pageForInstitution: async (institutionId, { limit, cursor }) => {
        const after = decodeCursor(cursor, isIdCursor);
        const docs = await AuditEventModel.find({
          institutionId,
          ...(after ? { _id: { $lt: new Types.ObjectId(after) } } : {}),
        })
          .sort({ _id: -1 })
          .limit(limit + 1);
        const page = toPage(docs, limit, (last) => String(last._id));
        return {
          items: page.items.map((d) => {
            const r = rec<Record<string, unknown>>(d);
            return { ...r, at: (r.at as Date).toISOString() } as never;
          }),
          nextCursor: page.nextCursor,
        };
      },
    },
  };
}
