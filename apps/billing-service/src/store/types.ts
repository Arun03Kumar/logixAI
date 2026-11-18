import type { AuditEvent, PlanOptionId } from "@logixai/contracts";

export type OrderStatus = "created" | "paid";

export interface OrderRecord {
  id: string;
  userId: string;
  planId: PlanOptionId;
  days: number;
  listPaise: number;
  discountPaise: number;
  totalPaise: number;
  couponId: string | null;
  couponCode: string | null;
  provider: "razorpay" | "mock" | "coupon";
  providerOrderId: string | null;
  status: OrderStatus;
  providerPaymentId: string | null;
  receiptNumber: string | null;
  paidAt: Date | null;
  /** Pro granted in identity-service. Null on a paid order means the grant is still to retry. */
  fulfilledAt: Date | null;
  createdAt: Date;
}

export interface CouponRecord {
  id: string;
  code: string;
  percentOff: number | null;
  amountOffPaise: number | null;
  planIds: PlanOptionId[] | null;
  maxRedemptions: number | null;
  redemptions: number;
  expiresAt: Date | null;
  active: boolean;
  createdBy: string;
  createdAt: Date;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

/** createdAt is set by the caller (from the injectable clock), the id by the store. */
type New<T> = Omit<T, "id">;

export interface Store {
  orders: {
    create(data: New<OrderRecord>): Promise<OrderRecord>;
    get(id: string): Promise<OrderRecord | null>;
    findByProviderOrderId(providerOrderId: string): Promise<OrderRecord | null>;
    /** created -> paid, once. Returns the paid order, or null if it was already paid (or missing). */
    markPaid(id: string, update: { providerPaymentId: string | null; receiptNumber: string; paidAt: Date }): Promise<OrderRecord | null>;
    markFulfilled(id: string, at: Date): Promise<void>;
    /** Paid orders of a user, newest first. */
    listPaidForUser(userId: string): Promise<OrderRecord[]>;
    /** Paid but not yet granted, paid before `before` (for the retry sweep). */
    listUnfulfilled(before: Date, limit: number): Promise<OrderRecord[]>;
    /** Admin: paid orders, newest first. */
    pagePaid(query: { limit: number; cursor?: string }): Promise<Page<OrderRecord>>;
    /** Admin: number of paid orders and revenue since a date. */
    totalsSince(since: Date): Promise<{ count: number; revenuePaise: number }>;
  };
  coupons: {
    /** Throws an error with code 11000 if the code exists. */
    create(data: New<CouponRecord>): Promise<CouponRecord>;
    findByCode(code: string): Promise<CouponRecord | null>;
    list(): Promise<CouponRecord[]>;
    setActive(id: string, active: boolean): Promise<CouponRecord | null>;
    /** Counts one redemption. */
    redeem(id: string): Promise<void>;
  };
  trials: {
    /** Records the user's trial once. False if they already had one. */
    claim(userId: string, at: Date): Promise<boolean>;
    get(userId: string): Promise<{ at: Date } | null>;
  };
  /** Sequential receipt numbers per year: LX-2026-000001. */
  nextReceiptNumber(year: number): Promise<string>;
  audit: {
    record(event: Omit<AuditEvent, "id" | "at">): Promise<void>;
  };
}
