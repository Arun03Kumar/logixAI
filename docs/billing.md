# Plans and billing

LogixAI is free to use; **Pro** unlocks Pro-only problems and removes the free
plan's daily limit on code runs. Schools and colleges get Pro for every member
through an **institution licence**.

## How it works

```
web /pricing ──► billing-service ──► Razorpay (orders, Checkout, webhooks)
                      │
                      └── internal API ──► identity-service ──► plan in session + access token
                                                                  │
arena-service (and any service) reads `plan` / `planUntil` from the token ◄┘
```

- **billing-service** (port 3011, database `logixai-billing`) sells prepaid
  **Pro passes**: 1 month or 12 months. A pass doesn't renew on its own;
  buying again adds to the end of the current one. It also handles coupons,
  the one-time free trial, receipts and admin tools. Collections: `orders`,
  `coupons`, `trials`, `counters` (receipt numbers), `audit_events`.
- **identity-service** is the source of truth for who has Pro. A user has Pro
  while their personal pass (`users.proUntil`) or a licence on any of their
  institutions (`institutions.licenceUntil`) is in the future. The result is
  in the session (`user.plan`) and in every access token as `plan` and
  `planUntil`, so other services check it without a call. Grants are recorded
  in `entitlement_grants` with a unique reference, so a repeated grant (a
  retried webhook, a double click) never adds time twice.
- Access tokens live 15 minutes, so a change of plan reaches other services at
  the next refresh. The web app refreshes the session right after a payment.

### What Pro unlocks today

- Items with `access: pro` in the ML Arena content (a locked item shows its
  title and statement, nothing else; answering, running and revealing return 403).
- No daily cap on code runs. Free users get `FREE_DAILY_CODE_RUNS` (30) per
  India-time day. The per-minute rate limit applies to everyone.

To make more content Pro, set `access: pro` on items. To change what Pro
includes, change the checks in arena-service (`requireAccess`, the daily cap).

## Prices, trials and coupons

- Prices live in `packages/contracts/src/billing.ts` (`PLAN_OPTIONS`), in
  paise, GST included. The server always computes the amount from this table
  and the coupon; the browser only sends a plan id and a coupon code.
- **Trial**: `TRIAL_DAYS` (7) of Pro, once per account, only for accounts that
  have never bought Pro.
- **Coupons** (Billing admin page): a percentage or a rupee amount off,
  optionally limited to plans, a number of uses and an expiry date. A 100%
  coupon grants Pro without a payment. Totals between ₹0 and ₹1 round up to
  ₹1 (Razorpay's minimum). The use count is checked at checkout and counted
  when payment completes, so two people using the last use at the same moment
  can both succeed.
- **Complimentary Pro** (Billing admin > Grant Pro): adds days to a user, by
  email, with a reason that goes in the audit log.
- **Institution licences** (Billing admin > Institution licences, platform
  admins only): set an end date and the seats bought. Every member has Pro
  until then. Seats are recorded for invoicing; joining isn't blocked when
  they run out yet.

## Payments and safety

1. `POST /billing/checkout` creates our order and a Razorpay order for the
   server-computed amount.
2. The browser opens Razorpay Checkout. Card and UPI details go to Razorpay,
   never to LogixAI.
3. On success the browser sends Razorpay's ids and signature to
   `POST /billing/verify`. The server checks
   `HMAC-SHA256(order_id|payment_id, key secret)` before granting.
4. Razorpay also calls the webhook (`payment.captured`, `order.paid`),
   signed with the webhook secret and checked against the order's amount. It
   covers the case where the browser closes before step 3.
5. Each order is marked paid exactly once and gets a sequential receipt
   number (`LX-2026-000123`). If identity-service is down at that moment, the
   payment is kept and a sweep retries the grant every minute.

Without Razorpay keys (development only), billing uses a **mock checkout**: a
dialog in the browser completes the order through `POST /billing/dev/pay`. No
money moves, and the endpoint refuses to work when real keys are configured.
In production, billing refuses to start without keys and a webhook secret.

## Setting up Razorpay

Do these in your own Razorpay account (Claude doesn't create accounts or handle
keys):

1. Sign up at razorpay.com. Test mode works straight away; live mode needs
   business KYC.
2. **Test keys**: Dashboard > Account & Settings > API Keys > Generate test
   key. Put the key id (`rzp_test_...`) and secret in
   `apps/billing-service/.env` as `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET`.
3. **Webhook**: Dashboard > Webhooks > Add new webhook.
   - URL: `https://<your billing host>/api/v1/billing/webhooks/razorpay`
     (Razorpay must be able to reach it; for local testing use a tunnel such
     as ngrok or cloudflared).
   - Secret: a long random string; put the same value in
     `RAZORPAY_WEBHOOK_SECRET`.
   - Events: `payment.captured` and `order.paid`.
4. Make sure payments are captured automatically (Dashboard > Account &
   Settings > Payment capture), so `payment.captured` fires.
5. Set the same `INTERNAL_API_TOKEN` (16+ characters) in identity-service and
   billing-service.
6. Restart billing-service; its log says `payments: razorpay`. Pay with a
   Razorpay test card or test UPI id to try it.
7. Going live: complete KYC, generate **live** keys, set them (and a live
   webhook) in production only.

## Not built yet

- GST tax invoices (GSTIN, tax breakdown). Receipts show the GST-inclusive total.
- Refunds through the app (refund in the Razorpay dashboard and, if needed,
  shorten the pass from the admin side — not built yet either).
- Auto-renewing subscriptions (UPI Autopay / e-mandates), referral rewards and
  annual institution invoicing.
- Enforcing institution seat limits.
