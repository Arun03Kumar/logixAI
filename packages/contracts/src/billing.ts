import { z } from "zod";

/**
 * Plans and billing.
 *
 * LogixAI sells prepaid Pro passes (1 or 12 months) rather than auto-renewing
 * subscriptions: buying again extends the pass. Prices are in paise and
 * include GST. To change a price, change it here; the server always computes
 * amounts from this table, never from the browser.
 */

export const PLAN_TIERS = ["free", "pro"] as const;
export type PlanTier = (typeof PLAN_TIERS)[number];

export interface PlanOption {
  id: "pro_month" | "pro_year";
  tier: "pro";
  name: string;
  /** Days of Pro added on purchase. */
  days: number;
  /** Price in paise (₹1 = 100 paise), GST included. */
  pricePaise: number;
  /** Shown next to the price, e.g. "Save 37%". */
  badge?: string;
}

export const PLAN_OPTIONS: readonly PlanOption[] = [
  { id: "pro_month", tier: "pro", name: "Pro · 1 month", days: 30, pricePaise: 39_900 },
  { id: "pro_year", tier: "pro", name: "Pro · 12 months", days: 365, pricePaise: 299_900, badge: "Save 37%" },
];
export type PlanOptionId = PlanOption["id"];
export const PLAN_OPTION_IDS = PLAN_OPTIONS.map((p) => p.id) as [PlanOptionId, ...PlanOptionId[]];
export const findPlanOption = (id: string) => PLAN_OPTIONS.find((p) => p.id === id);

/** Free trial of Pro, once per account. */
export const TRIAL_DAYS = 7;

/** Code runs per day (India time) on the free plan. Pro has no daily cap. */
export const FREE_DAILY_CODE_RUNS = 30;

/** What the signed-in user's plan is right now (in the session and access token). */
export interface PlanState {
  tier: PlanTier;
  /** When Pro ends (ISO), null on free. */
  until: string | null;
  /** personal = bought or trial or granted; institution = an institution licence. */
  source: "personal" | "institution" | null;
}

export const FREE_PLAN: PlanState = { tier: "free", until: null, source: null };

/** Rupees with two decimals only when needed: 39900 -> "₹399", 9950 -> "₹99.50". */
export function formatRupees(paise: number): string {
  const rupees = paise / 100;
  return `₹${rupees.toLocaleString("en-IN", { minimumFractionDigits: Number.isInteger(rupees) ? 0 : 2, maximumFractionDigits: 2 })}`;
}

/* ── Checkout ── */

const CouponCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9-]{3,30}$/, "Coupon codes are 3–30 letters, digits or dashes");

export const CheckoutSchema = z.object({
  planId: z.enum(PLAN_OPTION_IDS),
  couponCode: CouponCode.optional(),
});
export type CheckoutInput = z.infer<typeof CheckoutSchema>;

export const CouponCheckSchema = z.object({ planId: z.enum(PLAN_OPTION_IDS), couponCode: CouponCode });

export interface PriceQuote {
  planId: PlanOptionId;
  listPaise: number;
  discountPaise: number;
  totalPaise: number;
  couponCode: string | null;
}

/** What the browser needs to open the payment window. */
export interface CheckoutSession {
  orderId: string;
  /** razorpay = real Razorpay Checkout; mock = local test checkout (development only). */
  provider: "razorpay" | "mock";
  /** Razorpay's order id and public key id (provider "razorpay" only). */
  providerOrderId: string | null;
  keyId: string | null;
  quote: PriceQuote;
  description: string;
  prefill: { name: string; email: string };
}

/** A 100% coupon needs no payment: Pro is granted straight away. */
export type CheckoutResult = { kind: "pay"; session: CheckoutSession } | { kind: "granted"; payment: PaymentView };

export const VerifyPaymentSchema = z.object({
  orderId: z.string().min(1).max(100),
  providerPaymentId: z.string().min(1).max(100),
  signature: z.string().min(1).max(200),
});
export type VerifyPaymentInput = z.infer<typeof VerifyPaymentSchema>;

export type PaymentStatus = "paid" | "free";

export interface PaymentView {
  id: string;
  /** Receipt number shown to the customer, e.g. LX-2026-000123. */
  receiptNumber: string;
  planId: PlanOptionId;
  planName: string;
  days: number;
  listPaise: number;
  discountPaise: number;
  totalPaise: number;
  couponCode: string | null;
  status: PaymentStatus;
  provider: "razorpay" | "mock" | "coupon";
  providerPaymentId: string | null;
  paidAt: string;
}

export interface BillingOverview {
  trialAvailable: boolean;
  trialUsedAt: string | null;
  payments: PaymentView[];
}

/* ── Admin ── */

export const CreateCouponSchema = z
  .object({
    code: CouponCode,
    percentOff: z.number().int().min(1).max(100).nullable().default(null),
    amountOffPaise: z.number().int().min(100).nullable().default(null),
    /** null = every plan */
    planIds: z.array(z.enum(PLAN_OPTION_IDS)).min(1).nullable().default(null),
    maxRedemptions: z.number().int().min(1).max(100_000).nullable().default(null),
    expiresAt: z.string().datetime().nullable().default(null),
  })
  .refine((c) => (c.percentOff === null) !== (c.amountOffPaise === null), {
    message: "Give either a percentage or an amount off",
    path: ["percentOff"],
  });
export type CreateCouponInput = z.infer<typeof CreateCouponSchema>;

export interface CouponView {
  id: string;
  code: string;
  percentOff: number | null;
  amountOffPaise: number | null;
  planIds: PlanOptionId[] | null;
  maxRedemptions: number | null;
  redemptions: number;
  expiresAt: string | null;
  active: boolean;
  createdAt: string;
}

export const GrantProSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  days: z.number().int().min(1).max(3650),
  note: z.string().trim().min(3, "Say why (it goes in the audit log)").max(200),
});
export type GrantProInput = z.infer<typeof GrantProSchema>;

/** identity-service internal API: extend a user's personal Pro. Idempotent per reference. */
export const EntitlementGrantSchema = z.object({
  userId: z.string().min(1),
  days: z.number().int().min(1).max(3650),
  /** Unique per grant (order id, "trial:<userId>", ...): repeats are ignored. */
  reference: z.string().min(1).max(200),
  source: z.enum(["purchase", "trial", "admin"]),
});
export type EntitlementGrantInput = z.infer<typeof EntitlementGrantSchema>;

/** Platform admin view of an institution and its licence. */
export interface AdminInstitutionView {
  id: string;
  name: string;
  slug: string;
  type: string;
  memberCount: number;
  licenceUntil: string | null;
  licenceSeats: number | null;
  createdAt: string;
}

export const InstitutionLicenceSchema = z.object({
  /** null removes the licence. */
  until: z.string().datetime().nullable(),
  /** Seats bought (informational for now); null = unlimited. */
  seats: z.number().int().min(1).max(1_000_000).nullable().default(null),
});
export type InstitutionLicenceInput = z.infer<typeof InstitutionLicenceSchema>;
