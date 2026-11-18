import mongoose, { Schema, Types } from "mongoose";
import { AUDIT_ACTIONS, PLAN_OPTION_IDS } from "@logixai/contracts";
import { decodeCursor, toPage } from "@logixai/service-kit";
import type { CouponRecord, OrderRecord, Store } from "./types.js";

const orderSchema = new Schema(
  {
    userId: { type: String, required: true },
    planId: { type: String, enum: PLAN_OPTION_IDS, required: true },
    days: { type: Number, required: true },
    listPaise: { type: Number, required: true },
    discountPaise: { type: Number, required: true },
    totalPaise: { type: Number, required: true },
    couponId: { type: String, default: null },
    couponCode: { type: String, default: null },
    provider: { type: String, enum: ["razorpay", "mock", "coupon"], required: true },
    providerOrderId: { type: String, default: null },
    status: { type: String, enum: ["created", "paid"], required: true },
    providerPaymentId: { type: String, default: null },
    receiptNumber: { type: String, default: null },
    paidAt: { type: Date, default: null },
    fulfilledAt: { type: Date, default: null },
    createdAt: { type: Date, required: true },
  },
  { collection: "orders", versionKey: false },
);
// Webhooks find orders by Razorpay's id; each provider order and payment maps to one of ours.
orderSchema.index({ providerOrderId: 1 }, { unique: true, partialFilterExpression: { providerOrderId: { $type: "string" } } });
orderSchema.index({ providerPaymentId: 1 }, { unique: true, partialFilterExpression: { providerPaymentId: { $type: "string" } } });
orderSchema.index({ receiptNumber: 1 }, { unique: true, partialFilterExpression: { receiptNumber: { $type: "string" } } });
// A user's billing history; the retry sweep; the admin list.
orderSchema.index({ userId: 1, status: 1, paidAt: -1 });
orderSchema.index({ status: 1, fulfilledAt: 1, paidAt: 1 });
orderSchema.index({ status: 1, _id: -1 });
const Order = mongoose.model("Order", orderSchema);

const couponSchema = new Schema(
  {
    code: { type: String, required: true, unique: true },
    percentOff: { type: Number, default: null },
    amountOffPaise: { type: Number, default: null },
    planIds: { type: [String], default: null },
    maxRedemptions: { type: Number, default: null },
    redemptions: { type: Number, default: 0 },
    expiresAt: { type: Date, default: null },
    active: { type: Boolean, default: true },
    createdBy: { type: String, required: true },
    createdAt: { type: Date, required: true },
  },
  { collection: "coupons", versionKey: false },
);
const Coupon = mongoose.model("Coupon", couponSchema);

const Trial = mongoose.model(
  "Trial",
  new Schema(
    { userId: { type: String, required: true, unique: true }, at: { type: Date, required: true } },
    { collection: "trials", versionKey: false },
  ),
);

const Counter = mongoose.model(
  "Counter",
  new Schema({ _id: { type: String, required: true }, seq: { type: Number, default: 0 } }, { collection: "counters", versionKey: false }),
);

const AuditEventModel = mongoose.model(
  "AuditEvent",
  new Schema(
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
  ).index({ actorId: 1, _id: -1 }),
);

type Lean<T> = Omit<T, "id"> & { _id: Types.ObjectId };
const withId = <T extends { id: string }>(doc: Lean<T> | null): T | null => {
  if (!doc) return null;
  const { _id, ...rest } = doc;
  return { ...rest, id: String(_id) } as unknown as T;
};
const order = (doc: unknown) => withId<OrderRecord>(doc as Lean<OrderRecord> | null);
const coupon = (doc: unknown) => withId<CouponRecord>(doc as Lean<CouponRecord> | null);
const isId = (v: unknown): v is string => typeof v === "string" && Types.ObjectId.isValid(v);

export function createMongoStore(): Store {
  return {
    orders: {
      create: async (data) => order((await Order.create(data)).toObject())!,
      get: async (id) => (isId(id) ? order(await Order.findById(id).lean()) : null),
      findByProviderOrderId: async (providerOrderId) => order(await Order.findOne({ providerOrderId }).lean()),
      markPaid: async (id, update) =>
        order(await Order.findOneAndUpdate({ _id: id, status: "created" }, { $set: { ...update, status: "paid" } }, { new: true }).lean()),
      markFulfilled: async (id, at) => {
        await Order.updateOne({ _id: id }, { $set: { fulfilledAt: at } });
      },
      listPaidForUser: async (userId) =>
        (await Order.find({ userId, status: "paid" }).sort({ paidAt: -1 }).limit(200).lean()).map((d) => order(d)!),
      listUnfulfilled: async (before, limit) =>
        (await Order.find({ status: "paid", fulfilledAt: null, paidAt: { $lt: before } }).limit(limit).lean()).map((d) => order(d)!),
      pagePaid: async ({ limit, cursor }) => {
        const after = decodeCursor(cursor, isId);
        const docs = await Order.find({ status: "paid", ...(after ? { _id: { $lt: new Types.ObjectId(after) } } : {}) })
          .sort({ _id: -1 })
          .limit(limit + 1)
          .lean();
        const page = toPage(docs, limit, (last) => String(last._id));
        return { items: page.items.map((d) => order(d)!), nextCursor: page.nextCursor };
      },
      totalsSince: async (since) => {
        const [row] = await Order.aggregate<{ count: number; revenuePaise: number }>([
          { $match: { status: "paid", paidAt: { $gte: since } } },
          { $group: { _id: null, count: { $sum: 1 }, revenuePaise: { $sum: "$totalPaise" } } },
        ]);
        return { count: row?.count ?? 0, revenuePaise: row?.revenuePaise ?? 0 };
      },
    },
    coupons: {
      create: async (data) => coupon((await Coupon.create(data)).toObject())!,
      findByCode: async (code) => coupon(await Coupon.findOne({ code }).lean()),
      list: async () => (await Coupon.find().sort({ createdAt: -1 }).limit(500).lean()).map((d) => coupon(d)!),
      setActive: async (id, active) =>
        isId(id) ? coupon(await Coupon.findByIdAndUpdate(id, { $set: { active } }, { new: true }).lean()) : null,
      redeem: async (id) => {
        await Coupon.updateOne({ _id: id }, { $inc: { redemptions: 1 } });
      },
    },
    trials: {
      claim: async (userId, at) => {
        try {
          await Trial.create({ userId, at });
          return true;
        } catch (err) {
          if ((err as { code?: number }).code === 11000) return false;
          throw err;
        }
      },
      get: async (userId) => {
        const t = await Trial.findOne({ userId }).lean();
        return t ? { at: t.at } : null;
      },
    },
    nextReceiptNumber: async (year) => {
      const doc = await Counter.findOneAndUpdate({ _id: `receipt-${year}` }, { $inc: { seq: 1 } }, { upsert: true, new: true }).lean();
      return `LX-${year}-${String(doc!.seq).padStart(6, "0")}`;
    },
    audit: {
      record: async (event) => {
        await AuditEventModel.create(event);
      },
    },
  };
}
