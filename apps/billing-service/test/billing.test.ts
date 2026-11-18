import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { EntitlementGrantInput } from "@logixai/contracts";
import { NotFoundError, UnauthorizedError, type AccessTokenVerifier } from "@logixai/service-kit";
import { buildApp } from "../src/app.js";
import type { IdentityGateway } from "../src/lib/identity.js";
import { createMockProvider, createRazorpayProvider, razorpaySignature, type PaymentProvider } from "../src/providers/index.js";
import type { BillingService } from "../src/services/billingService.js";
import { createMemoryStore } from "../src/store/memoryStore.js";

const KEY_SECRET = "test_key_secret";
const WEBHOOK_SECRET = "test_webhook_secret";

/** Tokens in tests are "Bearer <userId>"; "boss" is a platform admin. */
const verifier: AccessTokenVerifier = {
  async verify(token) {
    return { sub: token, role: token === "boss" ? "admin" : "user", name: token, email: `${token}@x.com`, plan: "free", planUntil: null };
  },
  async verifyHeader(header) {
    const token = String(header ?? "").replace(/^Bearer /, "");
    if (!token) throw new UnauthorizedError();
    return this.verify(token);
  },
};

let grants: EntitlementGrantInput[];
let identityDown: boolean;
const identity: IdentityGateway = {
  async grantPro(input) {
    if (identityDown) throw new Error("identity unreachable");
    const applied = !grants.some((g) => g.reference === input.reference);
    if (applied) grants.push(input);
    return { proUntil: "2027-01-01T00:00:00.000Z", applied };
  },
  async userByEmail(email) {
    if (email !== "asha@x.com") throw new NotFoundError("User", email);
    return { id: "asha", name: "Asha", email };
  },
};

let razorpayOrders: { amount: number; auth: string }[];
const fakeFetch = (async (_url: string, init: RequestInit) => {
  const body = JSON.parse(String(init.body));
  razorpayOrders.push({ amount: body.amount, auth: String((init.headers as Record<string, string>).Authorization) });
  return new Response(JSON.stringify({ id: `order_rzp${razorpayOrders.length}`, amount: body.amount }), { status: 200 });
}) as unknown as typeof fetch;

let app: FastifyInstance;
let billing: BillingService;
let store: ReturnType<typeof createMemoryStore>;

async function setup(provider: PaymentProvider) {
  grants = [];
  identityDown = false;
  razorpayOrders = [];
  store = createMemoryStore();
  const built = await buildApp({ store, provider, identity, verifier, corsOrigins: [], now: () => new Date("2026-11-18T10:00:00Z") });
  app = built.app;
  billing = built.billing;
}
const razorpay = () =>
  createRazorpayProvider({ keyId: "rzp_test_abc", keySecret: KEY_SECRET, webhookSecret: WEBHOOK_SECRET, fetchImpl: fakeFetch });

async function req(user: string | null, method: string, url: string, payload?: unknown) {
  const res = await app.inject({
    method: method as never,
    url: `/api/v1/billing${url}`,
    headers: user ? { authorization: `Bearer ${user}` } : {},
    payload: payload as never,
  });
  return { status: res.statusCode, data: res.json().data, body: res.json() };
}

function webhook(body: unknown, secret = WEBHOOK_SECRET) {
  const raw = JSON.stringify(body);
  return app.inject({
    method: "POST",
    url: "/api/v1/billing/webhooks/razorpay",
    headers: { "content-type": "application/json", "x-razorpay-signature": createHmac("sha256", secret).update(raw).digest("hex") },
    payload: raw,
  });
}
const captured = (orderId: string, paymentId: string, amount: number) => ({
  event: "payment.captured",
  payload: { payment: { entity: { id: paymentId, order_id: orderId, amount, currency: "INR", status: "captured" } } },
});

describe("pricing and coupons", () => {
  beforeEach(() => setup(createMockProvider()));

  it("publishes the plans and quotes coupons", async () => {
    const plans = (await req(null, "GET", "/plans")).data;
    expect(plans.options.map((p: { id: string }) => p.id)).toEqual(["pro_month", "pro_year"]);

    await req("boss", "POST", "/admin/coupons", { code: "launch20", percentOff: 20 });
    await req("boss", "POST", "/admin/coupons", { code: "YEARONLY", amountOffPaise: 50_000, planIds: ["pro_year"] });
    await req("boss", "POST", "/admin/coupons", { code: "ONCE", percentOff: 10, maxRedemptions: 1 });
    await req("boss", "POST", "/admin/coupons", { code: "OLD", percentOff: 10, expiresAt: "2026-01-01T00:00:00.000Z" });

    const q = await req("asha", "POST", "/quote", { planId: "pro_month", couponCode: "Launch20" });
    expect(q.data).toEqual({ planId: "pro_month", listPaise: 39_900, discountPaise: 7_980, totalPaise: 31_920, couponCode: "LAUNCH20" });
    expect((await req("asha", "POST", "/quote", { planId: "pro_year", couponCode: "YEARONLY" })).data.totalPaise).toBe(249_900);
    expect((await req("asha", "POST", "/quote", { planId: "pro_month", couponCode: "YEARONLY" })).body.error.reason).toMatch(/doesn't apply/);
    expect((await req("asha", "POST", "/quote", { planId: "pro_month", couponCode: "OLD" })).body.error.reason).toMatch(/expired/);
    expect((await req("asha", "POST", "/quote", { planId: "pro_month", couponCode: "NOPE" })).status).toBe(400);
    expect((await req(null, "POST", "/quote", { planId: "pro_month", couponCode: "LAUNCH20" })).status).toBe(401);
  });

  it("rounds tiny totals up to the ₹1 minimum", async () => {
    await req("boss", "POST", "/admin/coupons", { code: "ALMOST", amountOffPaise: 39_850 });
    expect((await req("asha", "POST", "/quote", { planId: "pro_month", couponCode: "ALMOST" })).data).toMatchObject({ totalPaise: 100, discountPaise: 39_800 });
  });

  it("grants straight away on a 100% coupon and counts the redemption", async () => {
    await req("boss", "POST", "/admin/coupons", { code: "FREEMONTH", percentOff: 100, maxRedemptions: 1 });
    const res = await req("asha", "POST", "/checkout", { planId: "pro_month", couponCode: "FREEMONTH" });
    expect(res.data.kind).toBe("granted");
    expect(res.data.payment).toMatchObject({ status: "free", totalPaise: 0, provider: "coupon", receiptNumber: "LX-2026-000001" });
    expect(grants).toEqual([expect.objectContaining({ userId: "asha", days: 30, source: "purchase" })]);
    expect((await req("ravi", "POST", "/quote", { planId: "pro_month", couponCode: "FREEMONTH" })).body.error.reason).toMatch(/fully used/);
  });
});

describe("mock checkout (development)", () => {
  beforeEach(() => setup(createMockProvider()));

  it("completes an order once and keeps a receipt", async () => {
    const checkout = (await req("asha", "POST", "/checkout", { planId: "pro_year" })).data;
    expect(checkout.kind).toBe("pay");
    expect(checkout.session).toMatchObject({ provider: "mock", keyId: null, providerOrderId: null, description: "Pro · 12 months" });
    expect(checkout.session.quote.totalPaise).toBe(299_900);
    expect(grants).toEqual([]);

    // Someone else can't pay (or see) Asha's order.
    expect((await req("ravi", "POST", "/dev/pay", { orderId: checkout.session.orderId })).status).toBe(404);

    const paid = (await req("asha", "POST", "/dev/pay", { orderId: checkout.session.orderId })).data;
    expect(paid).toMatchObject({ status: "paid", totalPaise: 299_900, days: 365, receiptNumber: "LX-2026-000001" });
    await req("asha", "POST", "/dev/pay", { orderId: checkout.session.orderId });
    expect(grants).toEqual([{ userId: "asha", days: 365, reference: `order:${checkout.session.orderId}`, source: "purchase" }]);

    const me = (await req("asha", "GET", "/me")).data;
    expect(me).toMatchObject({ trialAvailable: false, trialUsedAt: null });
    expect(me.payments).toHaveLength(1);
    expect((await req("asha", "GET", `/receipts/${paid.id}`)).data.receiptNumber).toBe("LX-2026-000001");
    expect((await req("ravi", "GET", `/receipts/${paid.id}`)).status).toBe(404);
  });

  it("retries the grant when identity-service was down", async () => {
    identityDown = true;
    const checkout = (await req("asha", "POST", "/checkout", { planId: "pro_month" })).data;
    const paid = await req("asha", "POST", "/dev/pay", { orderId: checkout.session.orderId });
    expect(paid.status).toBe(200); // the payment is safe even though Pro wasn't granted yet
    expect(grants).toEqual([]);
    identityDown = false;
    // The sweep only retries orders paid a little while ago; pretend time passed.
    const later = billing as unknown as { deps: { now: () => Date } };
    later.deps.now = () => new Date("2026-11-18T10:05:00Z");
    expect(await billing.sweepUnfulfilled()).toBe(1);
    expect(grants).toHaveLength(1);
    expect(await billing.sweepUnfulfilled()).toBe(0);
  });

  it("gives one free trial, only to accounts that haven't paid", async () => {
    expect((await req("asha", "GET", "/me")).data.trialAvailable).toBe(true);
    expect((await req("asha", "POST", "/trial")).status).toBe(200);
    expect(grants).toEqual([{ userId: "asha", days: 7, reference: "trial:asha", source: "trial" }]);
    expect((await req("asha", "POST", "/trial")).status).toBe(409);
    expect((await req("asha", "GET", "/me")).data).toMatchObject({ trialAvailable: false });

    const checkout = (await req("ravi", "POST", "/checkout", { planId: "pro_month" })).data;
    await req("ravi", "POST", "/dev/pay", { orderId: checkout.session.orderId });
    expect((await req("ravi", "POST", "/trial")).status).toBe(409);
  });
});

describe("Razorpay", () => {
  beforeEach(() => setup(razorpay()));

  it("creates the Razorpay order server-side with the server's price", async () => {
    const checkout = (await req("asha", "POST", "/checkout", { planId: "pro_month" })).data;
    expect(razorpayOrders).toEqual([{ amount: 39_900, auth: `Basic ${Buffer.from(`rzp_test_abc:${KEY_SECRET}`).toString("base64")}` }]);
    expect(checkout.session).toMatchObject({ provider: "razorpay", keyId: "rzp_test_abc", providerOrderId: "order_rzp1" });
    // Test payments are off when real keys are configured.
    expect((await req("asha", "POST", "/dev/pay", { orderId: checkout.session.orderId })).status).toBe(403);
  });

  it("verifies the checkout signature before granting", async () => {
    const { session } = (await req("asha", "POST", "/checkout", { planId: "pro_month" })).data;
    const forged = await req("asha", "POST", "/verify", { orderId: session.orderId, providerPaymentId: "pay_1", signature: "0".repeat(64) });
    expect(forged.status).toBe(400);
    expect(grants).toEqual([]);

    const signature = razorpaySignature(KEY_SECRET, "order_rzp1", "pay_1");
    const ok = await req("asha", "POST", "/verify", { orderId: session.orderId, providerPaymentId: "pay_1", signature });
    expect(ok.data).toMatchObject({ status: "paid", providerPaymentId: "pay_1" });

    // The webhook for the same payment arrives afterwards: no second grant.
    const hook = await webhook(captured("order_rzp1", "pay_1", 39_900));
    expect(hook.statusCode).toBe(200);
    expect(grants).toHaveLength(1);
  });

  it("fulfils from the webhook when the browser never came back", async () => {
    const { session } = (await req("asha", "POST", "/checkout", { planId: "pro_year" })).data;
    const hook = await webhook(captured(session.providerOrderId, "pay_9", 299_900));
    expect(hook.json().data).toEqual({ handled: true });
    expect(grants).toEqual([expect.objectContaining({ userId: "asha", days: 365 })]);
    expect((await req("asha", "GET", "/me")).data.payments[0]).toMatchObject({ providerPaymentId: "pay_9" });
  });

  it("rejects forged webhooks and mismatched amounts", async () => {
    const { session } = (await req("asha", "POST", "/checkout", { planId: "pro_year" })).data;
    expect((await webhook(captured(session.providerOrderId, "pay_9", 299_900), "wrong-secret")).statusCode).toBe(400);
    expect((await webhook(captured(session.providerOrderId, "pay_9", 100))).json().data).toEqual({ handled: false });
    expect((await webhook({ event: "refund.created", payload: {} })).json().data).toEqual({ handled: false });
    expect(grants).toEqual([]);
  });
});

describe("admin", () => {
  beforeEach(() => setup(createMockProvider()));

  it("is for platform admins, and audits what they do", async () => {
    expect((await req("asha", "GET", "/admin/coupons")).status).toBe(403);
    expect((await req("asha", "POST", "/admin/coupons", { code: "X100", percentOff: 100 })).status).toBe(403);

    const coupon = await req("boss", "POST", "/admin/coupons", { code: "DIWALI", percentOff: 30 });
    expect(coupon.status).toBe(201);
    expect((await req("boss", "POST", "/admin/coupons", { code: "DIWALI", percentOff: 10 })).status).toBe(409);
    expect((await req("boss", "POST", "/admin/coupons", { code: "BOTH", percentOff: 10, amountOffPaise: 500 })).status).toBe(400);
    await req("boss", "POST", `/admin/coupons/${coupon.data.id}/disable`);
    expect((await req("asha", "POST", "/quote", { planId: "pro_month", couponCode: "DIWALI" })).status).toBe(400);

    const grant = await req("boss", "POST", "/admin/grants", { email: "asha@x.com", days: 90, note: "Contest prize" });
    expect(grant.data).toMatchObject({ email: "asha@x.com" });
    expect(grants[0]).toMatchObject({ userId: "asha", days: 90, source: "admin" });
    expect((await req("boss", "POST", "/admin/grants", { email: "nobody@x.com", days: 90, note: "Typo" })).status).toBe(404);

    const checkout = (await req("asha", "POST", "/checkout", { planId: "pro_month" })).data;
    await req("asha", "POST", "/dev/pay", { orderId: checkout.session.orderId });
    const payments = (await req("boss", "GET", "/admin/payments")).data;
    expect(payments.last30Days).toEqual({ count: 1, revenuePaise: 39_900 });
    expect(payments.items[0]).toMatchObject({ userId: "asha", totalPaise: 39_900 });

    expect(store.auditLog.map((e) => e.action)).toEqual(["billing.coupon_created", "billing.coupon_disabled", "billing.pro_granted"]);
  });
});
