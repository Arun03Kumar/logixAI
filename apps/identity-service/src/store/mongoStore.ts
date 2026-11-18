import mongoose, { Schema, Types } from "mongoose";
import {
  AUDIT_ACTIONS,
  INSTITUTION_ROLES,
  INSTITUTION_TYPES,
  INVITABLE_ROLES,
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
      email: { type: String, required: true, unique: true, lowercase: true, trim: true },
      passwordHash: { type: String, required: true },
      role: { type: String, enum: PLATFORM_ROLES, default: "user" },
    },
    opts,
  ),
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
    },
    opts,
  ),
);

const membershipSchema = new Schema(
  {
    userId: { type: String, required: true },
    institutionId: { type: String, required: true },
    role: { type: String, enum: INSTITUTION_ROLES, required: true },
    /** Derived from role (owner 4 … student 1) so members list owners first, in the database. */
    roleRank: { type: Number, required: true },
    batchIds: { type: [String], default: [] },
  },
  opts,
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
  },
  opts,
);
// "CSE 2026" and "cse 2026" are the same batch.
batchSchema.index({ institutionId: 1, name: 1 }, { unique: true, collation: caseInsensitive });
const Batch = mongoose.model("Batch", batchSchema);

const inviteSchema = new Schema(
  {
    institutionId: { type: String, required: true },
    code: { type: String, required: true, unique: true },
    role: { type: String, enum: INVITABLE_ROLES, required: true },
    batchId: { type: String, default: null },
    maxUses: { type: Number, default: null },
    uses: { type: Number, default: 0 },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    createdBy: { type: String, required: true },
  },
  opts,
);
inviteSchema.index({ institutionId: 1, createdAt: -1 });
const Invite = mongoose.model("Invite", inviteSchema);

/** Append-only record of who changed what (see packages/contracts/src/audit.ts). */
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
      findByEmail: async (email) => recOrNull(await User.findOne({ email })),
      findByIds: async (ids) => recs(await User.find({ _id: { $in: ids.filter(isId) } })),
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
    },
    memberships: {
      create: async (data) => rec(await Membership.create({ ...data, roleRank: ROLE_RANK[data.role] })),
      find: async (userId, institutionId) =>
        recOrNull(await Membership.findOne({ userId, institutionId })),
      listForUser: async (userId) => recs(await Membership.find({ userId }).sort({ createdAt: 1 })),
      pageForInstitution: async (institutionId, { limit, cursor, role, userIds, batchId }) => {
        const after = decodeCursor(cursor, isMembershipCursor);
        const filter: Record<string, unknown> = { institutionId };
        if (role) filter.role = role;
        if (userIds) filter.userId = { $in: userIds };
        if (batchId) filter.batchIds = batchId;
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
