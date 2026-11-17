import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { createLocalJWKSet } from "jose";
import {
  CreateBatchSchema,
  CreateInstitutionSchema,
  CreateInviteSchema,
  SignInSchema,
  SignUpSchema,
  UpdateMemberSchema,
  type AccessTokenClaims,
} from "@logixai/contracts";
import {
  BadRequestError,
  createAccessTokenVerifier,
  errorResponse,
  successResponse,
  type z,
} from "@logixai/service-kit";
import type { TokenIssuer } from "./lib/tokens.js";
import { AuthService, type IssuedSession } from "./services/authService.js";
import { InstitutionService } from "./services/institutionService.js";
import type { Store } from "./store/types.js";

export const REFRESH_COOKIE = "lx_rt";
const REFRESH_COOKIE_PATH = "/api/v1/auth";

export interface AppOptions {
  store: Store;
  tokens: TokenIssuer;
  issuer: string;
  corsOrigins: string[];
  secureCookies: boolean;
  refreshTokenTtlDays: number;
  adminEmails: string[];
  logger?: boolean;
  /** Requests per minute per IP on sign-in / sign-up. */
  authRateLimit?: number;
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
  const app = Fastify({ logger: options.logger ?? false, trustProxy: true });
  const authService = new AuthService(options.store, options.tokens, {
    refreshTokenTtlDays: options.refreshTokenTtlDays,
    adminEmails: options.adminEmails,
  });
  const institutions = new InstitutionService(options.store);
  // Verify our own tokens with the same code path other services use.
  const verifier = createAccessTokenVerifier({
    jwksUrl: "http://unused.local",
    issuer: options.issuer,
    keys: createLocalJWKSet(options.tokens.jwks()),
  });

  await app.register(cookie);
  await app.register(cors, { origin: options.corsOrigins, credentials: true });
  await app.register(rateLimit, { global: false });

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
      path: REFRESH_COOKIE_PATH,
      expires: issued.refreshExpiresAt,
    });
    return reply.status(status).send(successResponse(issued.session));
  };
  const clearSession = (reply: FastifyReply) =>
    reply.clearCookie(REFRESH_COOKIE, { path: REFRESH_COOKIE_PATH });

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

  app.post("/api/v1/institutions", auth, async (request, reply) => {
    const input = parse(CreateInstitutionSchema, request.body, "institution");
    return reply.status(201).send(successResponse(await institutions.create(userId(request), input)));
  });

  app.get<IdParams>("/api/v1/institutions/:id", auth, async (request) =>
    successResponse(await institutions.get(userId(request), request.params.id)),
  );

  app.get<IdParams>("/api/v1/institutions/:id/members", auth, async (request) =>
    successResponse(await institutions.listMembers(userId(request), request.params.id)),
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

  app.get<IdParams>("/api/v1/institutions/:id/batches", auth, async (request) =>
    successResponse(await institutions.listBatches(userId(request), request.params.id)),
  );

  app.post<IdParams>("/api/v1/institutions/:id/batches", auth, async (request, reply) => {
    const input = parse(CreateBatchSchema, request.body, "batch");
    return reply
      .status(201)
      .send(successResponse(await institutions.createBatch(userId(request), request.params.id, input)));
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

  /* ── Joining ── */
  app.get<{ Params: { code: string } }>("/api/v1/invites/:code", async (request) =>
    successResponse(await institutions.previewInvite(request.params.code)),
  );

  app.post<{ Params: { code: string } }>("/api/v1/invites/:code/accept", auth, async (request) =>
    successResponse(await institutions.acceptInvite(userId(request), request.params.code)),
  );

  return app;
}
