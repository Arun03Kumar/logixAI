import { randomUUID } from "node:crypto";
import type { AuditEvent } from "@logixai/contracts";
import { decodeCursor, encodeCursor } from "@logixai/service-kit";
import type { CouponRecord, OrderRecord, Store } from "./types.js";

const clone = <T>(v: T): T => structuredClone(v);

/** In-memory Store for tests. Mirrors MongoStore's conditional updates. */
export function createMemoryStore(): Store & { auditLog: AuditEvent[] } {
  const orders: OrderRecord[] = [];
  const coupons: CouponRecord[] = [];
  const trials = new Map<string, Date>();
  const counters = new Map<number, number>();
  const auditLog: AuditEvent[] = [];
  const paidNewestFirst = () =>
    orders.filter((o) => o.status === "paid").sort((a, b) => b.paidAt!.getTime() - a.paidAt!.getTime());

  return {
    auditLog,
    orders: {
      async create(data) {
        const row = { ...clone(data), id: randomUUID() } as OrderRecord;
        orders.push(row);
        return clone(row);
      },
      get: async (id) => clone(orders.find((o) => o.id === id) ?? null),
      findByProviderOrderId: async (pid) => clone(orders.find((o) => o.providerOrderId === pid) ?? null),
      async markPaid(id, update) {
        const o = orders.find((x) => x.id === id);
        if (!o || o.status !== "created") return null;
        if (update.providerPaymentId && orders.some((x) => x.providerPaymentId === update.providerPaymentId)) {
          throw Object.assign(new Error("duplicate key"), { code: 11000 });
        }
        Object.assign(o, clone(update), { status: "paid" });
        return clone(o);
      },
      async markFulfilled(id, at) {
        const o = orders.find((x) => x.id === id);
        if (o) o.fulfilledAt = at;
      },
      listPaidForUser: async (userId) => paidNewestFirst().filter((o) => o.userId === userId).map(clone),
      listUnfulfilled: async (before, limit) =>
        orders.filter((o) => o.status === "paid" && !o.fulfilledAt && o.paidAt! < before).slice(0, limit).map(clone),
      async pagePaid({ limit, cursor }) {
        const start = decodeCursor(cursor, (v): v is number => Number.isInteger(v) && (v as number) >= 0) ?? 0;
        const rows = paidNewestFirst();
        return {
          items: rows.slice(start, start + limit).map(clone),
          nextCursor: rows.length > start + limit ? encodeCursor(start + limit) : null,
        };
      },
      async totalsSince(since) {
        const rows = orders.filter((o) => o.status === "paid" && o.paidAt! >= since);
        return { count: rows.length, revenuePaise: rows.reduce((s, o) => s + o.totalPaise, 0) };
      },
    },
    coupons: {
      async create(data) {
        if (coupons.some((c) => c.code === data.code)) throw Object.assign(new Error("duplicate key"), { code: 11000 });
        const row = { ...clone(data), id: randomUUID() } as CouponRecord;
        coupons.push(row);
        return clone(row);
      },
      findByCode: async (code) => clone(coupons.find((c) => c.code === code) ?? null),
      list: async () => [...coupons].reverse().map(clone),
      async setActive(id, active) {
        const c = coupons.find((x) => x.id === id);
        if (!c) return null;
        c.active = active;
        return clone(c);
      },
      async redeem(id) {
        const c = coupons.find((x) => x.id === id);
        if (c) c.redemptions += 1;
      },
    },
    trials: {
      async claim(userId, at) {
        if (trials.has(userId)) return false;
        trials.set(userId, at);
        return true;
      },
      get: async (userId) => (trials.has(userId) ? { at: trials.get(userId)! } : null),
    },
    async nextReceiptNumber(year) {
      const seq = (counters.get(year) ?? 0) + 1;
      counters.set(year, seq);
      return `LX-${year}-${String(seq).padStart(6, "0")}`;
    },
    audit: {
      async record(event) {
        auditLog.push({ ...clone(event), id: randomUUID(), at: new Date().toISOString() });
      },
    },
  };
}
