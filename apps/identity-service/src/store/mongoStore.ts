import mongoose, { Schema, Types } from "mongoose";
import {
  INSTITUTION_ROLES,
  INSTITUTION_TYPES,
  INVITABLE_ROLES,
  PLATFORM_ROLES,
} from "@logixai/contracts";
import type { Store } from "./types.js";

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
    userId: { type: String, required: true, index: true },
    institutionId: { type: String, required: true, index: true },
    role: { type: String, enum: INSTITUTION_ROLES, required: true },
    batchIds: { type: [String], default: [] },
  },
  opts,
);
membershipSchema.index({ userId: 1, institutionId: 1 }, { unique: true });
const Membership = mongoose.model("Membership", membershipSchema);

const batchSchema = new Schema(
  {
    institutionId: { type: String, required: true, index: true },
    name: { type: String, required: true },
  },
  opts,
);
batchSchema.index({ institutionId: 1, name: 1 }, { unique: true });
const Batch = mongoose.model("Batch", batchSchema);

const Invite = mongoose.model(
  "Invite",
  new Schema(
    {
      institutionId: { type: String, required: true, index: true },
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
  ),
);

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
      create: async (data) => rec(await Membership.create(data)),
      find: async (userId, institutionId) =>
        recOrNull(await Membership.findOne({ userId, institutionId })),
      listForUser: async (userId) => recs(await Membership.find({ userId }).sort({ createdAt: 1 })),
      listForInstitution: async (institutionId) =>
        recs(await Membership.find({ institutionId }).sort({ createdAt: 1 })),
      update: async (id, patch) =>
        recOrNull(await Membership.findByIdAndUpdate(id, patch, { new: true })),
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
  };
}
