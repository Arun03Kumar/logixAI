import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { createLocalJWKSet } from "jose";
import {
  AddOwnerSchema,
  AdminCreateInstitutionSchema,
  AdminUpdateInstitutionSchema,
  ContractSchema,
  CreateBatchSchema,
  CreateDepartmentSchema,
  CreateInstitutionSchema,
  CreateInviteSchema,
  ChangePasswordSchema,
  DecideJoinRequestSchema,
  EntitlementGrantSchema,
  ImportStudentsSchema,
  JoinSchema,
  PromoteBatchSchema,
  RollSignInSchema,
  UpdateBatchSchema,
  UpdateDepartmentSchema,
  UpdateFeaturesSchema,
  InstitutionRoleSchema,
  PageQuerySchema,
  SignInSchema,
  SignUpSchema,
  UpdateMemberSchema,
  type AccessTokenClaims,
} from "@logixai/contracts";
import {
  BadRequestError,
  ForbiddenError,
  UnauthorizedError,
  createAccessTokenVerifier,
  isInternalRequest,
  INTERNAL_TOKEN_HEADER,
  errorResponse,
  successResponse,
  z,
  rateLimitStore,
  type RedisClient,
  createLogger,
  fastifyRequestIdOptions,
  instrumentHttp,
} from "@logixai/service-kit";
import type { TokenIssuer } from "./lib/tokens.js";
import { AuthService, type IssuedSession } from "./services/authService.js";
import { AdminInstitutionService } from "./services/adminInstitutionService.js";
import { InstitutionService } from "./services/institutionService.js";
import { OnboardingService } from "./services/onboardingService.js";
import { PlanService } from "./services/planService.js";
import type { Store } from "./store/types.js";

export const REFRESH_COOKIE = "lx_rt";
const DEFAULT_REFRESH_COOKIE_PATH = "/api/v1/auth";

const httpLogger = createLogger("identity-service");

export interface AppOptions {
  store: Store;
  tokens: TokenIssuer;
  issuer: string;
  corsOrigins: string[];
  secureCookies: boolean;
  refreshTokenTtlDays: number;
  /**
   * Path the browser sends the refresh cookie to: the auth routes as the
   * browser sees them. Behind a path-prefix proxy (/api/identity/v1/auth ->
   * /api/v1/auth) set it to the public path.
   */
  refreshCookiePath?: string;
  adminEmails: string[];
  logger?: boolean;
  /** Requests per minute per IP on sign-in / sign-up. */
  authRateLimit?: number;
  /** Shared rate-limit counters (all replicas); in memory when unset. */
  rateLimitRedis?: RedisClient;
  /** Shared secret for /internal routes; unset = open (development only). */
  internalToken?: string;
}

declare module "fastify" {
  interface FastifyRequest {
    auth?: AccessTokenClaims;
  }
}

function parse<S extends z.ZodType>(schema: S, body: unknown, name: string): z.infer<S> {
  const result = schema.safeParse(body ?? {});
  if (!result.success) throw new BadRequestError(name, result.error.issues);
  return result.data;
}

export async function buildApp(options: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({ ...fastifyRequestIdOptions, logger: options.logger ?? false, trustProxy: true });
  // Request timing per route (/metrics) and X-Request-Id on every response; 5xx are logged with their id.
  instrumentHttp(app, "identity-service", httpLogger);
  const refreshCookiePath = options.refreshCookiePath ?? DEFAULT_REFRESH_COOKIE_PATH;
  const authService = new AuthService(options.store, options.tokens, {
    refreshTokenTtlDays: options.refreshTokenTtlDays,
    adminEmails: options.adminEmails,
  });
  const institutions = new InstitutionService(options.store);
  const plans = new PlanService(options.store);
  const adminInstitutions = new AdminInstitutionService(options.store, institutions);
  const onboarding = new OnboardingService(options.store, institutions);
  // Verify our own tokens with the same code path other services use.
  const verifier = createAccessTokenVerifier({
    jwksUrl: "http://unused.local",
    issuer: options.issuer,
    keys: createLocalJWKSet(options.tokens.jwks()),
  });

  await app.register(cookie);
  await app.register(cors, { origin: options.corsOrigins, credentials: true });
  await app.register(rateLimit, { global: false, ...rateLimitStore(options.rateLimitRedis, "identity") });

  app.setErrorHandler((err: Error & { statusCode?: number }, request, reply) => {
    const status = err.statusCode;
    if (typeof status === "number" && status < 500 && !("details" in err)) {
      // Framework errors (rate limit, malformed JSON): pass their message through.
      return reply.status(status).send({ success: false, message: err.message, error: {}, data: {} });
    }
    const { statusCode, body } = errorResponse(err);
    if (statusCode >= 500) request.log.error(err);
    return reply.status(statusCode).send(body);
  });

  const authenticate = async (request: FastifyRequest) => {
    request.auth = await verifier.verifyHeader(request.headers.authorization);
  };
  const userId = (request: FastifyRequest) => request.auth!.sub;

  const sendSession = (reply: FastifyReply, issued: IssuedSession, status = 200) => {
    reply.setCookie(REFRESH_COOKIE, issued.refreshToken, {
      httpOnly: true,
      secure: options.secureCookies,
      sameSite: "lax",
      path: refreshCookiePath,
      expires: issued.refreshExpiresAt,
    });
    return reply.status(status).send(successResponse(issued.session));
  };
  const clearSession = (reply: FastifyReply) =>
    reply.clearCookie(REFRESH_COOKIE, { path: refreshCookiePath });

  const authLimit = {
    config: { rateLimit: { max: options.authRateLimit ?? 10, timeWindow: "1 minute" } },
  };

  app.get("/ping", async () => ({ message: "identity service is alive" }));
  app.get("/.well-known/jwks.json", async () => options.tokens.jwks());

  /* ── Auth ── */
  app.post("/api/v1/auth/signup", authLimit, async (request, reply) => {
    const input = parse(SignUpSchema, request.body, "signup");
    return sendSession(reply, await authService.signUp(input), 201);
  });

  app.post("/api/v1/auth/login", authLimit, async (request, reply) => {
    const input = parse(SignInSchema, request.body, "login");
    return sendSession(reply, await authService.signIn(input));
  });

  app.post("/api/v1/auth/login/roll-number", authLimit, async (request, reply) => {
    const input = parse(RollSignInSchema, request.body, "login");
    return sendSession(reply, await authService.signInWithRollNumber(input));
  });

  app.post("/api/v1/auth/password", { ...authLimit, preHandler: authenticate }, async (request, reply) => {
    const input = parse(ChangePasswordSchema, request.body, "password");
    return sendSession(reply, await authService.changePassword(userId(request), input));
  });

  app.post("/api/v1/auth/refresh", async (request, reply) => {
    try {
      return sendSession(reply, await authService.refresh(request.cookies[REFRESH_COOKIE]));
    } catch (err) {
      clearSession(reply);
      throw err;
    }
  });

  app.post("/api/v1/auth/logout", async (request, reply) => {
    await authService.signOut(request.cookies[REFRESH_COOKIE]);
    clearSession(reply);
    return successResponse({}, "Signed out");
  });

  app.get("/api/v1/auth/me", { preHandler: authenticate }, async (request) =>
    successResponse(await authService.me(userId(request))),
  );

  /* ── Institutions ── */
  const auth = { preHandler: authenticate };
  type IdParams = { Params: { id: string } };

  // Institutions are set up by LogixAI (platform admins); see /api/v1/admin/institutions.
  app.post("/api/v1/institutions", auth, async (request, reply) => {
    if (request.auth!.role !== "admin") {
      throw new ForbiddenError("Institutions are set up by LogixAI. Contact us to get started.");
    }
    const input = parse(CreateInstitutionSchema, request.body, "institution");
    return reply.status(201).send(successResponse(await institutions.create(userId(request), input)));
  });

  app.get<IdParams>("/api/v1/institutions/:id", auth, async (request) =>
    successResponse(await institutions.get(userId(request), request.params.id)),
  );

  // ?limit=&cursor=&role=&batchId=&userIds=a,b,c (userIds: look up specific people, max 100)
  app.get<IdParams>("/api/v1/institutions/:id/members", auth, async (request) => {
    const query = parse(
      PageQuerySchema.extend({
        role: InstitutionRoleSchema.optional(),
        batchId: z.string().min(1).max(100).optional(),
        userIds: z
          .string()
          .optional()
          .transform((v) => (v ? v.split(",").filter(Boolean).slice(0, 100) : undefined)),
      }),
      request.query,
      "query",
    );
    const { userIds, role, batchId, ...page } = query;
    return successResponse(
      await institutions.listMembers(userId(request), request.params.id, {
        ...page,
        ...(role ? { role } : {}),
        ...(batchId ? { batchId } : {}),
        ...(userIds ? { userIds, limit: Math.max(page.limit, userIds.length) } : {}),
      }),
    );
  });

  app.get<IdParams>("/api/v1/institutions/:id/audit", auth, async (request) =>
    successResponse(
      await institutions.listAudit(
        userId(request),
        request.params.id,
        parse(PageQuerySchema, request.query, "query"),
      ),
    ),
  );

  app.patch<{ Params: { id: string; userId: string } }>(
    "/api/v1/institutions/:id/members/:userId",
    auth,
    async (request) => {
      const input = parse(UpdateMemberSchema, request.body, "member");
      return successResponse(
        await institutions.updateMember(userId(request), request.params.id, request.params.userId, input),
      );
    },
  );

  app.delete<{ Params: { id: string; userId: string } }>(
    "/api/v1/institutions/:id/members/:userId",
    auth,
    async (request) => {
      await institutions.removeMember(userId(request), request.params.id, request.params.userId);
      return successResponse({}, "Member removed");
    },
  );

  /* ── Onboarding ── */
  app.post<IdParams>("/api/v1/institutions/:id/import", auth, async (request) =>
    successResponse(await onboarding.importStudents(userId(request), request.params.id, parse(ImportStudentsSchema, request.body, "import"))),
  );
  app.post<{ Params: { id: string; userId: string } }>("/api/v1/institutions/:id/members/:userId/password", auth, async (request) =>
    successResponse(await onboarding.resetPassword(userId(request), request.params.id, request.params.userId)),
  );
  app.get<IdParams & { Querystring: { status?: string } }>("/api/v1/institutions/:id/join-requests", auth, async (request) => {
    const { status } = parse(z.object({ status: z.enum(["pending", "approved", "rejected"]).default("pending") }), request.query, "query");
    return successResponse(await onboarding.listJoinRequests(userId(request), request.params.id, status));
  });
  // Ask to join through the institution's email domain.
  app.post<IdParams>("/api/v1/institutions/:id/join-requests", auth, async (request, reply) =>
    reply
      .status(202)
      .send(successResponse(await onboarding.requestByDomain(userId(request), request.params.id, parse(JoinSchema, request.body, "join")))),
  );
  app.post<{ Params: { id: string; requestId: string } }>("/api/v1/institutions/:id/join-requests/:requestId/decision", auth, async (request) =>
    successResponse(
      await onboarding.decide(userId(request), request.params.id, request.params.requestId, parse(DecideJoinRequestSchema, request.body, "decision")),
    ),
  );
  app.get("/api/v1/institutions/suggested", auth, async (request) => successResponse(await onboarding.suggested(userId(request))));
  app.post<{ Params: { id: string; batchId: string } }>("/api/v1/institutions/:id/batches/:batchId/promote", auth, async (request) =>
    successResponse(
      await onboarding.promote(userId(request), request.params.id, request.params.batchId, parse(PromoteBatchSchema, request.body, "promote")),
    ),
  );

  app.get<IdParams>("/api/v1/institutions/:id/batches", auth, async (request) =>
    successResponse(await institutions.listBatches(userId(request), request.params.id)),
  );

  app.post<IdParams>("/api/v1/institutions/:id/batches", auth, async (request, reply) => {
    const input = parse(CreateBatchSchema, request.body, "batch");
    return reply
      .status(201)
      .send(successResponse(await institutions.createBatch(userId(request), request.params.id, input)));
  });

  app.patch<{ Params: { id: string; batchId: string } }>("/api/v1/institutions/:id/batches/:batchId", auth, async (request) =>
    successResponse(
      await institutions.updateBatch(userId(request), request.params.id, request.params.batchId, parse(UpdateBatchSchema, request.body, "batch")),
    ),
  );

  app.get<IdParams>("/api/v1/institutions/:id/departments", auth, async (request) =>
    successResponse(await institutions.listDepartments(userId(request), request.params.id)),
  );
  app.post<IdParams>("/api/v1/institutions/:id/departments", auth, async (request, reply) =>
    reply
      .status(201)
      .send(successResponse(await institutions.createDepartment(userId(request), request.params.id, parse(CreateDepartmentSchema, request.body, "department")))),
  );
  type DeptParams = { Params: { id: string; departmentId: string } };
  app.patch<DeptParams>("/api/v1/institutions/:id/departments/:departmentId", auth, async (request) =>
    successResponse(
      await institutions.updateDepartment(
        userId(request),
        request.params.id,
        request.params.departmentId,
        parse(UpdateDepartmentSchema, request.body, "department"),
      ),
    ),
  );
  app.delete<DeptParams>("/api/v1/institutions/:id/departments/:departmentId", auth, async (request) => {
    await institutions.deleteDepartment(userId(request), request.params.id, request.params.departmentId);
    return successResponse({}, "Department deleted");
  });

  app.get<IdParams>("/api/v1/institutions/:id/invites", auth, async (request) =>
    successResponse(await institutions.listInvites(userId(request), request.params.id)),
  );

  app.post<IdParams>("/api/v1/institutions/:id/invites", auth, async (request, reply) => {
    const input = parse(CreateInviteSchema, request.body, "invite");
    return reply
      .status(201)
      .send(successResponse(await institutions.createInvite(userId(request), request.params.id, input)));
  });

  app.delete<{ Params: { id: string; inviteId: string } }>(
    "/api/v1/institutions/:id/invites/:inviteId",
    auth,
    async (request) => {
      await institutions.revokeInvite(userId(request), request.params.id, request.params.inviteId);
      return successResponse({}, "Invite revoked");
    },
  );

  /* ── Platform admin ── */
  const platformAdmin = async (request: FastifyRequest) => {
    await authenticate(request);
    if (request.auth!.role !== "admin") throw new ForbiddenError("Platform admins only.");
  };
  const admin = { preHandler: platformAdmin };
  app.get<{ Querystring: { q?: string } }>("/api/v1/admin/institutions", admin, async (request) =>
    successResponse(await adminInstitutions.list(typeof request.query.q === "string" ? request.query.q.slice(0, 100) : undefined)),
  );
  app.post("/api/v1/admin/institutions", admin, async (request, reply) =>
    reply
      .status(201)
      .send(successResponse(await adminInstitutions.create(userId(request), parse(AdminCreateInstitutionSchema, request.body, "institution")))),
  );
  app.get<IdParams>("/api/v1/admin/institutions/:id", admin, async (request) =>
    successResponse(await adminInstitutions.detail(request.params.id)),
  );
  app.patch<IdParams>("/api/v1/admin/institutions/:id", admin, async (request) =>
    successResponse(
      await adminInstitutions.update(userId(request), request.params.id, parse(AdminUpdateInstitutionSchema, request.body, "institution")),
    ),
  );
  app.put<IdParams>("/api/v1/admin/institutions/:id/features", admin, async (request) =>
    successResponse(
      await adminInstitutions.setFeatures(userId(request), request.params.id, parse(UpdateFeaturesSchema, request.body, "features")),
    ),
  );
  // Body: the contract, or { "contract": null } to remove it.
  app.put<IdParams>("/api/v1/admin/institutions/:id/contract", admin, async (request) => {
    const body = request.body as { contract?: unknown } | null;
    const contract = body && "contract" in body && body.contract === null ? null : parse(ContractSchema, request.body, "contract");
    return successResponse(await adminInstitutions.setContract(userId(request), request.params.id, contract));
  });
  app.post<IdParams>("/api/v1/admin/institutions/:id/owners", admin, async (request) =>
    successResponse(
      await adminInstitutions.addOwner(userId(request), request.params.id, parse(AddOwnerSchema, request.body, "owner").email),
    ),
  );

  /* ── Internal (other services) ── */
  const internal = async (request: FastifyRequest) => {
    if (!isInternalRequest(options.internalToken, request.headers[INTERNAL_TOKEN_HEADER])) throw new UnauthorizedError();
  };
  app.post("/internal/entitlements/grant", { preHandler: internal }, async (request) =>
    successResponse(await plans.grant(parse(EntitlementGrantSchema, request.body, "grant"))),
  );
  app.get<{ Querystring: { email?: string } }>("/internal/users/by-email", { preHandler: internal }, async (request) =>
    successResponse(await plans.userByEmail(String(request.query.email ?? ""))),
  );

  /* ── Joining ── */
  app.get<{ Params: { code: string } }>("/api/v1/invites/:code", async (request) =>
    successResponse(await institutions.previewInvite(request.params.code)),
  );

  // 200 with the membership, or 202 { pending: true } when the invite needs approval.
  app.post<{ Params: { code: string } }>("/api/v1/invites/:code/accept", auth, async (request, reply) => {
    const result = await onboarding.acceptInvite(userId(request), request.params.code, parse(JoinSchema, request.body, "join"));
    return reply.status("pending" in result ? 202 : 200).send(successResponse(result));
  });

  return app;
}
