import { randomUUID } from "node:crypto";
import {
  FREE_PLAN,
  PLAN_OPTIONS,
  TRIAL_DAYS,
  findPlanOption,
  type AuditAction,
  type BillingOverview,
  type CheckoutInput,
  type CheckoutResult,
  type CouponView,
  type CreateCouponInput,
  type GrantProInput,
  type PaymentView,
  type PlanOptionId,
  type PriceQuote,
  type VerifyPaymentInput,
} from "@logixai/contracts";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError, type Logger } from "@logixai/service-kit";
import type { IdentityGateway } from "../lib/identity.js";
import type { PaymentProvider } from "../providers/index.js";
import type { CouponRecord, OrderRecord, Page, Store } from "../store/types.js";

export interface Caller {
  userId: string;
  name: string;
  email: string;
  role: "user" | "admin";
}

/** Razorpay's smallest order is ₹1. */
const MIN_CHARGE_PAISE = 100;
/** Paid orders not granted after this long are retried by the sweep. */
const SWEEP_GRACE_MS = 30_000;

const year = (d: Date) => d.getUTCFullYear();

export class BillingService {
  constructor(
    private readonly deps: {
      store: Store;
      provider: PaymentProvider;
      identity: IdentityGateway;
      logger?: Logger;
      now?: () => Date;
    },
  ) {}

  private now() {
    return this.deps.now?.() ?? new Date();
  }

  /* ── Pricing ── */

  private couponProblem(coupon: CouponRecord | null, planId: PlanOptionId): string | null {
    if (!coupon || !coupon.active) return "That coupon code isn't valid.";
    if (coupon.expiresAt && coupon.expiresAt <= this.now()) return "That coupon has expired.";
    if (coupon.maxRedemptions !== null && coupon.redemptions >= coupon.maxRedemptions) return "That coupon has been fully used.";
    if (coupon.planIds && !coupon.planIds.includes(planId)) return "That coupon doesn't apply to this plan.";
    return null;
  }

  /** Price for a plan and optional coupon. Throws a 400 with the reason if the coupon can't be used. */
  async quote(planId: PlanOptionId, couponCode?: string): Promise<{ quote: PriceQuote; coupon: CouponRecord | null }> {
    const plan = findPlanOption(planId)!;
    let coupon: CouponRecord | null = null;
    let discount = 0;
    if (couponCode) {
      coupon = await this.deps.store.coupons.findByCode(couponCode.toUpperCase());
      const problem = this.couponProblem(coupon, planId);
      if (problem) throw new BadRequestError("coupon", { reason: problem });
      discount = coupon!.percentOff !== null ? Math.round((plan.pricePaise * coupon!.percentOff) / 100) : Math.min(coupon!.amountOffPaise!, plan.pricePaise);
    }
    let total = plan.pricePaise - discount;
    // Anything between free and ₹1 is rounded up to the smallest charge.
    if (total > 0 && total < MIN_CHARGE_PAISE) {
      total = MIN_CHARGE_PAISE;
      discount = plan.pricePaise - total;
    }
    return {
      quote: { planId, listPaise: plan.pricePaise, discountPaise: discount, totalPaise: total, couponCode: coupon?.code ?? null },
      coupon,
    };
  }

  /* ── Buying ── */

  async checkout(caller: Caller, input: CheckoutInput): Promise<CheckoutResult> {
    const plan = findPlanOption(input.planId)!;
    const { quote, coupon } = await this.quote(input.planId, input.couponCode);
    const base = {
      userId: caller.userId,
      planId: plan.id,
      days: plan.days,
      listPaise: quote.listPaise,
      discountPaise: quote.discountPaise,
      totalPaise: quote.totalPaise,
      couponId: coupon?.id ?? null,
      couponCode: coupon?.code ?? null,
      status: "created" as const,
      providerPaymentId: null,
      receiptNumber: null,
      paidAt: null,
      fulfilledAt: null,
      createdAt: this.now(),
    };

    if (quote.totalPaise === 0) {
      // A 100% coupon: nothing to pay, grant straight away.
      const order = await this.deps.store.orders.create({ ...base, provider: "coupon", providerOrderId: null });
      return { kind: "granted", payment: await this.fulfil(order, null) };
    }

    const receipt = `lx_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
    const { providerOrderId } = await this.deps.provider.createOrder({
      amountPaise: quote.totalPaise,
      receipt,
      notes: { userId: caller.userId, planId: plan.id },
    });
    const order = await this.deps.store.orders.create({ ...base, provider: this.deps.provider.name, providerOrderId });
    return {
      kind: "pay",
      session: {
        orderId: order.id,
        provider: this.deps.provider.name,
        providerOrderId: this.deps.provider.name === "razorpay" ? providerOrderId : null,
        keyId: this.deps.provider.keyId,
        quote,
        description: plan.name,
        prefill: { name: caller.name, email: caller.email },
      },
    };
  }

  private async ownOrder(caller: Caller, orderId: string): Promise<OrderRecord> {
    const order = await this.deps.store.orders.get(orderId);
    // Same 404 for someone else's order.
    if (!order || order.userId !== caller.userId) throw new NotFoundError("Order", orderId);
    return order;
  }

  /** Razorpay Checkout's success handler: check the signature, then grant Pro. */
  async verify(caller: Caller, input: VerifyPaymentInput): Promise<PaymentView> {
    const order = await this.ownOrder(caller, input.orderId);
    if (order.status === "paid") return this.view(order);
    if (order.provider !== "razorpay" || !order.providerOrderId) {
      throw new BadRequestError("payment", { reason: "This order isn't paid through Razorpay." });
    }
    if (!this.deps.provider.verifyPaymentSignature(order.providerOrderId, input.providerPaymentId, input.signature)) {
      throw new BadRequestError("payment", { reason: "We couldn't verify this payment. If money was taken, it will be matched automatically within a few minutes." });
    }
    return this.fulfil(order, input.providerPaymentId);
  }

  /**
   * Razorpay webhook (payment.captured / order.paid): the backup path when the
   * browser closes before verify. Returns whether an order was fulfilled.
   */
  async webhook(rawBody: Buffer, signature: string | undefined): Promise<{ handled: boolean }> {
    if (!this.deps.provider.verifyWebhookSignature(rawBody, signature)) {
      throw new BadRequestError("webhook", { reason: "Invalid signature" });
    }
    let event: { event?: string; payload?: { payment?: { entity?: { id?: string; order_id?: string; amount?: number; currency?: string } } } };
    try {
      event = JSON.parse(rawBody.toString("utf8"));
    } catch {
      throw new BadRequestError("webhook", { reason: "Body isn't JSON" });
    }
    if (event.event !== "payment.captured" && event.event !== "order.paid") return { handled: false };
    const payment = event.payload?.payment?.entity;
    if (!payment?.id || !payment.order_id) return { handled: false };
    const order = await this.deps.store.orders.findByProviderOrderId(payment.order_id);
    if (!order) {
      this.deps.logger?.warn(`Webhook for unknown Razorpay order ${payment.order_id}`);
      return { handled: false };
    }
    if (payment.amount !== order.totalPaise || (payment.currency && payment.currency !== "INR")) {
      this.deps.logger?.error(`Webhook amount mismatch on order ${order.id}: got ${payment.amount} ${payment.currency}, expected ${order.totalPaise} INR`);
      return { handled: false };
    }
    await this.fulfil(order, payment.id);
    return { handled: true };
  }

  /** Development only (mock provider): complete an order without a real payment. */
  async devPay(caller: Caller, orderId: string): Promise<PaymentView> {
    if (this.deps.provider.name !== "mock") throw new ForbiddenError("Test payments are only available in development.");
    const order = await this.ownOrder(caller, orderId);
    if (order.status === "paid") return this.view(order);
    return this.fulfil(order, `mock_pay_${randomUUID().replace(/-/g, "").slice(0, 14)}`);
  }

  /**
   * Marks the order paid exactly once, then grants Pro in identity-service.
   * If the grant fails, the order stays unfulfilled and the sweep retries it.
   */
  private async fulfil(order: OrderRecord, providerPaymentId: string | null): Promise<PaymentView> {
    const now = this.now();
    const receiptNumber = await this.deps.store.nextReceiptNumber(year(now));
    let paid: OrderRecord | null;
    try {
      paid = await this.deps.store.orders.markPaid(order.id, { providerPaymentId, receiptNumber, paidAt: now });
    } catch (err) {
      if ((err as { code?: number }).code === 11000) throw new ConflictError("This payment was already used for another order.");
      throw err;
    }
    if (!paid) {
      // Verify and the webhook raced, or a retry: the order is already paid.
      return this.view((await this.deps.store.orders.get(order.id))!);
    }
    if (paid.couponId) await this.deps.store.coupons.redeem(paid.couponId);
    await this.grant(paid);
    return this.view((await this.deps.store.orders.get(paid.id))!);
  }

  private async grant(order: OrderRecord): Promise<boolean> {
    try {
      await this.deps.identity.grantPro({ userId: order.userId, days: order.days, reference: `order:${order.id}`, source: "purchase" });
      await this.deps.store.orders.markFulfilled(order.id, this.now());
      return true;
    } catch (err) {
      this.deps.logger?.error(`Granting Pro for order ${order.id} failed; will retry: ${(err as Error).message}`);
      return false;
    }
  }

  /** Retries grants for paid orders that identity-service didn't confirm. */
  async sweepUnfulfilled(): Promise<number> {
    const pending = await this.deps.store.orders.listUnfulfilled(new Date(this.now().getTime() - SWEEP_GRACE_MS), 50);
    let done = 0;
    for (const order of pending) if (await this.grant(order)) done++;
    return done;
  }

  /* ── Trials and history ── */

  async startTrial(caller: Caller): Promise<{ proUntil: string | null }> {
    if ((await this.deps.store.orders.listPaidForUser(caller.userId)).length) {
      throw new ConflictError("The free trial is for accounts that haven't bought Pro yet.");
    }
    if (!(await this.deps.store.trials.claim(caller.userId, this.now()))) {
      throw new ConflictError("You've already used your free trial.");
    }
    const res = await this.deps.identity.grantPro({ userId: caller.userId, days: TRIAL_DAYS, reference: `trial:${caller.userId}`, source: "trial" });
    return { proUntil: res.proUntil };
  }

  async overview(caller: Caller): Promise<BillingOverview> {
    const [trial, paid] = await Promise.all([
      this.deps.store.trials.get(caller.userId),
      this.deps.store.orders.listPaidForUser(caller.userId),
    ]);
    return {
      trialAvailable: !trial && paid.length === 0,
      trialUsedAt: trial ? trial.at.toISOString() : null,
      payments: paid.map((o) => this.view(o)),
    };
  }

  async receipt(caller: Caller, orderId: string): Promise<PaymentView> {
    const order = await this.ownOrder(caller, orderId);
    if (order.status !== "paid") throw new NotFoundError("Receipt", orderId);
    return this.view(order);
  }

  private view(o: OrderRecord): PaymentView {
    const plan = findPlanOption(o.planId);
    return {
      id: o.id,
      receiptNumber: o.receiptNumber ?? "",
      planId: o.planId,
      planName: plan?.name ?? o.planId,
      days: o.days,
      listPaise: o.listPaise,
      discountPaise: o.discountPaise,
      totalPaise: o.totalPaise,
      couponCode: o.couponCode,
      status: o.totalPaise === 0 ? "free" : "paid",
      provider: o.provider,
      providerPaymentId: o.providerPaymentId,
      paidAt: (o.paidAt ?? o.createdAt).toISOString(),
    };
  }

  /* ── Admin ── */

  private admin(caller: Caller) {
    if (caller.role !== "admin") throw new ForbiddenError("Platform admins only.");
  }

  private couponView(c: CouponRecord): CouponView {
    return {
      id: c.id,
      code: c.code,
      percentOff: c.percentOff,
      amountOffPaise: c.amountOffPaise,
      planIds: c.planIds,
      maxRedemptions: c.maxRedemptions,
      redemptions: c.redemptions,
      expiresAt: c.expiresAt ? c.expiresAt.toISOString() : null,
      active: c.active,
      createdAt: c.createdAt.toISOString(),
    };
  }

  async listCoupons(caller: Caller): Promise<CouponView[]> {
    this.admin(caller);
    return (await this.deps.store.coupons.list()).map((c) => this.couponView(c));
  }

  async createCoupon(caller: Caller, input: CreateCouponInput): Promise<CouponView> {
    this.admin(caller);
    try {
      const c = await this.deps.store.coupons.create({
        code: input.code,
        percentOff: input.percentOff,
        amountOffPaise: input.amountOffPaise,
        planIds: input.planIds,
        maxRedemptions: input.maxRedemptions,
        redemptions: 0,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
        active: true,
        createdBy: caller.userId,
        createdAt: this.now(),
      });
      await this.audit(caller, "billing.coupon_created", "coupon", c.id, { code: c.code, percentOff: c.percentOff, amountOffPaise: c.amountOffPaise });
      return this.couponView(c);
    } catch (err) {
      if ((err as { code?: number }).code === 11000) throw new ConflictError(`A coupon called ${input.code} already exists.`);
      throw err;
    }
  }

  async disableCoupon(caller: Caller, id: string): Promise<CouponView> {
    this.admin(caller);
    const c = await this.deps.store.coupons.setActive(id, false);
    if (!c) throw new NotFoundError("Coupon", id);
    await this.audit(caller, "billing.coupon_disabled", "coupon", c.id, { code: c.code });
    return this.couponView(c);
  }

  /** Complimentary Pro (support, partners, contest prizes), by email, with a reason. */
  async grantPro(caller: Caller, input: GrantProInput): Promise<{ email: string; proUntil: string | null }> {
    this.admin(caller);
    const user = await this.deps.identity.userByEmail(input.email);
    const res = await this.deps.identity.grantPro({ userId: user.id, days: input.days, reference: `admin:${randomUUID()}`, source: "admin" });
    await this.audit(caller, "billing.pro_granted", "user", user.id, { email: user.email, days: input.days, note: input.note });
    return { email: user.email, proUntil: res.proUntil };
  }

  async payments(caller: Caller, query: { limit: number; cursor?: string }): Promise<Page<PaymentView & { userId: string }> & { last30Days: { count: number; revenuePaise: number } }> {
    this.admin(caller);
    const [page, last30Days] = await Promise.all([
      this.deps.store.orders.pagePaid(query),
      this.deps.store.orders.totalsSince(new Date(this.now().getTime() - 30 * 86_400_000)),
    ]);
    return { items: page.items.map((o) => ({ ...this.view(o), userId: o.userId })), nextCursor: page.nextCursor, last30Days };
  }

  private async audit(caller: Caller, action: AuditAction, targetType: "user" | "coupon", targetId: string, meta: Record<string, unknown>) {
    await this.deps.store.audit.record({ actorId: caller.userId, action, institutionId: null, targetType, targetId, meta }).catch(() => {});
  }

  plans() {
    return { options: PLAN_OPTIONS, free: FREE_PLAN, trialDays: TRIAL_DAYS };
  }
}
