import { BILLING_API_URL } from "@/app/coding-platform/lib/config";
import { authFetch, readEnvelope } from "@/app/lib/auth/session";
import { pageQuery } from "./pageQuery";

const call = (path, { method = "GET", body } = {}) =>
  authFetch(`${BILLING_API_URL}/billing${path}`, {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  }).then(readEnvelope);

export const billingApi = {
  plans: () => call("/plans"),
  quote: (planId, couponCode) => call("/quote", { method: "POST", body: { planId, couponCode } }),
  /** -> { kind: "pay", session } or { kind: "granted", payment } (100% coupon) */
  checkout: (planId, couponCode) =>
    call("/checkout", { method: "POST", body: { planId, ...(couponCode ? { couponCode } : {}) } }),
  verify: (orderId, providerPaymentId, signature) =>
    call("/verify", { method: "POST", body: { orderId, providerPaymentId, signature } }),
  /** Development only: complete a mock order. */
  devPay: (orderId) => call("/dev/pay", { method: "POST", body: { orderId } }),
  startTrial: () => call("/trial", { method: "POST" }),
  overview: () => call("/me"),
  receipt: (id) => call(`/receipts/${encodeURIComponent(id)}`),

  // Platform admins
  coupons: () => call("/admin/coupons"),
  createCoupon: (input) => call("/admin/coupons", { method: "POST", body: input }),
  disableCoupon: (id) => call(`/admin/coupons/${encodeURIComponent(id)}/disable`, { method: "POST" }),
  grantPro: (input) => call("/admin/grants", { method: "POST", body: input }),
  payments: ({ cursor, limit = 25 } = {}) => call(`/admin/payments?${pageQuery({ cursor, limit })}`),
};
