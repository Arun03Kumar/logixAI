import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import {
  CheckoutSchema,
  CouponCheckSchema,
  CreateCouponSchema,
  GrantProSchema,
  PageQuerySchema,
  VerifyPaymentSchema,
} from "@logixai/contracts";
import {
  BadRequestError,
  UnauthorizedError,
  errorResponse,
  successResponse,
  type AccessTokenVerifier,
  type Logger,
  z,
} from "@logixai/service-kit";
import type { IdentityGateway } from "./lib/identity.js";
import type { PaymentProvider } from "./providers/index.js";
import { BillingService, type Caller } from "./services/billingService.js";
import type { Store } from "./store/types.js";

export interface AppOptions {
  store: Store;
  provider: PaymentProvider;
  identity: IdentityGateway;
  verifier: AccessTokenVerifier;
  corsOrigins: string[];
  logger?: Logger;
  now?: () => Date;
}

declare module "fastify" {
  interface FastifyRequest {
    caller: Caller | null;
  }
}

function parse<S extends z.ZodType>(schema: S, body: unknown, name: string): z.infer<S> {
  const result = schema.safeParse(body ?? {});
  if (!result.success) throw new BadRequestError(name, result.error.issues);
  return result.data;
}

export async function buildApp(options: AppOptions): Promise<{ app: FastifyInstance; billing: BillingService }> {
  const app = Fastify({ logger: false, bodyLimit: 64 * 1024, trustProxy: true });
  const billing = new BillingService({
    store: options.store,
    provider: options.provider,
    identity: options.identity,
    ...(options.logger ? { logger: options.logger } : {}),
    ...(options.now ? { now: options.now } : {}),
  });

  await app.register(cors, { origin: options.corsOrigins, methods: ["GET", "POST"] });
  await app.register(rateLimit, { global: false, hook: "preHandler" });

  app.setErrorHandler((err: Error & { statusCode?: number }, request, reply) => {
    const status = err.statusCode;
    if (typeof status === "number" && status < 500 && !("details" in err)) {
      return reply.status(status).send({ success: false, message: err.message, error: {}, data: {} });
    }
    const { statusCode, body } = errorResponse(err);
    if (statusCode >= 500) options.logger?.error(err.message);
    return reply.status(statusCode).send(body);
  });

  app.decorateRequest("caller", null);
  app.addHook("onRequest", async (request) => {
    if (!request.headers.authorization) return;
    const claims = await options.verifier.verifyHeader(request.headers.authorization);
    request.caller = { userId: claims.sub, name: claims.name, email: claims.email, role: claims.role };
  });
  const caller = (request: FastifyRequest): Caller => {
    if (!request.caller) throw new UnauthorizedError();
    return request.caller;
  };
  const perUser = (max: number) => ({
    config: { rateLimit: { max, timeWindow: "1 minute", keyGenerator: (req: FastifyRequest) => req.caller?.userId ?? req.ip } },
  });
  const ok = <T>(data: T) => successResponse(data);
  const base = "/api/v1/billing";

  app.get("/ping", async () => ({ message: "billing service is alive", provider: options.provider.name }));

  app.get(`${base}/plans`, async () => ok(billing.plans()));
  app.post(`${base}/quote`, perUser(30), async (req) => {
    caller(req);
    const input = parse(CouponCheckSchema, req.body, "coupon");
    return ok((await billing.quote(input.planId, input.couponCode)).quote);
  });
  app.post(`${base}/checkout`, perUser(10), async (req) => ok(await billing.checkout(caller(req), parse(CheckoutSchema, req.body, "checkout"))));
  app.post(`${base}/verify`, perUser(20), async (req) => ok(await billing.verify(caller(req), parse(VerifyPaymentSchema, req.body, "payment"))));
  app.post(`${base}/dev/pay`, perUser(20), async (req) => {
    const { orderId } = parse(z.object({ orderId: z.string().min(1).max(100) }), req.body, "order");
    return ok(await billing.devPay(caller(req), orderId));
  });
  app.post(`${base}/trial`, perUser(5), async (req) => ok(await billing.startTrial(caller(req))));
  app.get(`${base}/me`, async (req) => ok(await billing.overview(caller(req))));
  app.get<{ Params: { id: string } }>(`${base}/receipts/:id`, async (req) => ok(await billing.receipt(caller(req), req.params.id)));

  /* ── Admin (platform admins) ── */
  app.get(`${base}/admin/coupons`, async (req) => ok(await billing.listCoupons(caller(req))));
  app.post(`${base}/admin/coupons`, async (req, reply) =>
    reply.status(201).send(ok(await billing.createCoupon(caller(req), parse(CreateCouponSchema, req.body, "coupon")))),
  );
  app.post<{ Params: { id: string } }>(`${base}/admin/coupons/:id/disable`, async (req) => ok(await billing.disableCoupon(caller(req), req.params.id)));
  app.post(`${base}/admin/grants`, async (req) => ok(await billing.grantPro(caller(req), parse(GrantProSchema, req.body, "grant"))));
  app.get(`${base}/admin/payments`, async (req) => ok(await billing.payments(caller(req), parse(PageQuerySchema, req.query, "query"))));

  /* ── Razorpay webhook: needs the raw body to check the signature ── */
  await app.register(async (scope) => {
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser("*", { parseAs: "buffer", bodyLimit: 256 * 1024 }, (_req, body, done) => done(null, body));
    scope.post(`${base}/webhooks/razorpay`, async (req) => {
      const signature = req.headers["x-razorpay-signature"];
      const result = await billing.webhook(req.body as Buffer, Array.isArray(signature) ? signature[0] : signature);
      return ok(result);
    });
  });

  return { app, billing };
}
