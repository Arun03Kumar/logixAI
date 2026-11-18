/**
 * Payment providers. Razorpay in production; a mock in development when no
 * keys are configured, so the whole purchase flow can be tried locally
 * without an account and without moving money.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export interface PaymentProvider {
  name: "razorpay" | "mock";
  /** Public key id for Razorpay Checkout (null for mock). */
  keyId: string | null;
  createOrder(order: { amountPaise: number; receipt: string; notes: Record<string, string> }): Promise<{ providerOrderId: string }>;
  /** Checkout's handler signature: HMAC-SHA256(order_id + "|" + payment_id, key secret). */
  verifyPaymentSignature(providerOrderId: string, providerPaymentId: string, signature: string): boolean;
  /** Webhook signature: HMAC-SHA256(raw body, webhook secret). */
  verifyWebhookSignature(rawBody: Buffer, signature: string | undefined): boolean;
}

const hmacHex = (secret: string, data: string | Buffer) => createHmac("sha256", secret).update(data).digest("hex");

/** Constant-time comparison of two hex strings. */
export function safeEqualHex(expected: string, given: string): boolean {
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(given, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function razorpaySignature(secret: string, providerOrderId: string, providerPaymentId: string): string {
  return hmacHex(secret, `${providerOrderId}|${providerPaymentId}`);
}

export function createRazorpayProvider(options: {
  keyId: string;
  keySecret: string;
  webhookSecret?: string;
  fetchImpl?: typeof fetch;
}): PaymentProvider {
  const doFetch = options.fetchImpl ?? fetch;
  const auth = `Basic ${Buffer.from(`${options.keyId}:${options.keySecret}`).toString("base64")}`;
  return {
    name: "razorpay",
    keyId: options.keyId,
    async createOrder({ amountPaise, receipt, notes }) {
      const res = await doFetch("https://api.razorpay.com/v1/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: auth },
        body: JSON.stringify({ amount: amountPaise, currency: "INR", receipt, notes }),
      });
      const body = (await res.json().catch(() => null)) as { id?: string; error?: { description?: string } } | null;
      if (!res.ok || !body?.id) {
        throw new Error(`Razorpay order failed (${res.status}): ${body?.error?.description ?? "no details"}`);
      }
      return { providerOrderId: body.id };
    },
    verifyPaymentSignature(providerOrderId, providerPaymentId, signature) {
      return safeEqualHex(razorpaySignature(options.keySecret, providerOrderId, providerPaymentId), signature);
    },
    verifyWebhookSignature(rawBody, signature) {
      if (!options.webhookSecret || !signature) return false;
      return safeEqualHex(hmacHex(options.webhookSecret, rawBody), signature);
    },
  };
}

/** Development only: orders are local and are "paid" through POST /billing/dev/pay. */
export function createMockProvider(): PaymentProvider {
  return {
    name: "mock",
    keyId: null,
    async createOrder() {
      return { providerOrderId: `mock_order_${randomBytes(8).toString("hex")}` };
    },
    verifyPaymentSignature: () => false,
    verifyWebhookSignature: () => false,
  };
}
