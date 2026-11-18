import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { AnswerInputSchema, AssignTrackSchema, CodeRunInputSchema, PageQuerySchema } from "@logixai/contracts";
import {
  BadRequestError,
  UnauthorizedError,
  errorResponse,
  successResponse,
  type AccessTokenVerifier,
  z,
} from "@logixai/service-kit";
import type { Catalog } from "./content/catalog.js";
import type { IdentityClient } from "./lib/identity.js";
import { ArenaService, type JudgeGateway } from "./services/arenaService.js";
import { InstitutionArenaService, type Caller } from "./services/institutionService.js";
import type { Store } from "./store/types.js";

export interface AppOptions {
  catalog: Catalog;
  store: Store;
  judge: JudgeGateway;
  identity: IdentityClient;
  verifier: AccessTokenVerifier;
  corsOrigins: string[];
  codeRunsPerMinute?: number;
  now?: () => Date;
  logger?: boolean;
}

declare module "fastify" {
  interface FastifyRequest {
    userId: string | null;
  }
}

function parse<S extends z.ZodType>(schema: S, body: unknown, name: string): z.infer<S> {
  const result = schema.safeParse(body ?? {});
  if (!result.success) throw new BadRequestError(name, result.error.issues);
  return result.data;
}

export async function buildApp(options: AppOptions): Promise<{ app: FastifyInstance; arena: ArenaService }> {
  const app = Fastify({ logger: options.logger ?? false, bodyLimit: 256 * 1024, trustProxy: true });
  const arena = new ArenaService({
    catalog: options.catalog,
    store: options.store,
    judge: options.judge,
    ...(options.now ? { now: options.now } : {}),
  });
  const institutions = new InstitutionArenaService({
    catalog: options.catalog,
    store: options.store,
    identity: options.identity,
    ...(options.now ? { now: options.now } : {}),
  });

  await app.register(cors, { origin: options.corsOrigins, methods: ["GET", "POST", "DELETE"] });
  // Runs after onRequest, so code-run limits can be per learner.
  await app.register(rateLimit, { global: false, hook: "preHandler" });

  app.setErrorHandler((err: Error & { statusCode?: number }, request, reply) => {
    const status = err.statusCode;
    if (typeof status === "number" && status < 500 && !("details" in err)) {
      return reply.status(status).send({ success: false, message: err.message, error: {}, data: {} });
    }
    const { statusCode, body } = errorResponse(err);
    if (statusCode >= 500) request.log.error(err);
    return reply.status(statusCode).send(body);
  });

  // Browsing works signed out; a token, when sent, must be valid.
  app.decorateRequest("userId", null);
  app.addHook("onRequest", async (request) => {
    if (!request.headers.authorization) return;
    request.userId = (await options.verifier.verifyHeader(request.headers.authorization)).sub;
  });
  const user = (request: FastifyRequest) => {
    if (!request.userId) throw new UnauthorizedError();
    return request.userId;
  };
  /** Signed-in caller plus their token, forwarded to identity-service. */
  const caller = (request: FastifyRequest): Caller => ({
    userId: user(request),
    authorization: request.headers.authorization!,
  });

  type P<T> = { Params: T };
  const ok = <T>(data: T) => successResponse(data);
  const base = "/api/v1/arena";

  app.get("/ping", async () => ({ message: "arena service is alive" }));

  /* ── Catalog ── */
  app.get(`${base}/tracks`, async (req) => ok(await arena.listTracks(req.userId)));
  app.get<P<{ trackId: string }>>(`${base}/tracks/:trackId`, async (req) =>
    ok(await arena.getTrack(req.userId, req.params.trackId)),
  );
  app.get<P<{ topicId: string }>>(`${base}/topics/:topicId`, async (req) =>
    ok(await arena.getTopic(req.userId, req.params.topicId)),
  );
  app.get<P<{ itemId: string }>>(`${base}/items/:itemId`, async (req) =>
    ok(await arena.getItem(req.userId, req.params.itemId)),
  );

  /* ── Practice (signed in) ── */
  app.post<P<{ itemId: string }>>(`${base}/items/:itemId/answer`, async (req) =>
    ok(await arena.answer(user(req), req.params.itemId, parse(AnswerInputSchema, req.body, "answer"))),
  );
  app.post<P<{ itemId: string }>>(`${base}/items/:itemId/reveal`, async (req) =>
    ok(await arena.reveal(user(req), req.params.itemId)),
  );
  app.post<P<{ itemId: string }>>(
    `${base}/items/:itemId/code`,
    {
      config: {
        rateLimit: {
          max: options.codeRunsPerMinute ?? 12,
          timeWindow: "1 minute",
          keyGenerator: (req: FastifyRequest) => req.userId ?? req.ip,
        },
      },
    },
    async (req, reply) =>
      reply
        .status(202)
        .send(ok(await arena.runCode(user(req), req.params.itemId, parse(CodeRunInputSchema, req.body, "code")))),
  );
  app.get(`${base}/submissions`, async (req) =>
    ok(
      await arena.listSubmissions(
        user(req),
        parse(PageQuerySchema.extend({ itemId: z.string().max(100).optional() }), req.query, "query"),
      ),
    ),
  );
  app.get<P<{ id: string }>>(`${base}/submissions/:id`, async (req) =>
    ok(await arena.getSubmission(user(req), req.params.id)),
  );
  app.get(`${base}/me/dashboard`, async (req) => ok(await arena.dashboard(user(req))));
  app.get(`${base}/me/review`, async (req) => ok(await arena.reviewQueue(user(req))));
  app.get(`${base}/me/assignments`, async (req) => ok(await institutions.mine(caller(req))));
  // Signed out: the map with no progress.
  app.get(`${base}/skill-map`, async (req) => ok(await arena.skillMap(req.userId)));

  /* ── Institutions ── */
  type Inst = { institutionId: string };
  app.get<P<Inst>>(`${base}/institutions/:institutionId/assignments`, async (req) =>
    ok(await institutions.list(caller(req), req.params.institutionId)),
  );
  app.post<P<Inst>>(`${base}/institutions/:institutionId/assignments`, async (req, reply) =>
    reply
      .status(201)
      .send(ok(await institutions.assign(caller(req), req.params.institutionId, parse(AssignTrackSchema, req.body, "assignment")))),
  );
  app.delete<P<Inst & { assignmentId: string }>>(
    `${base}/institutions/:institutionId/assignments/:assignmentId`,
    async (req) => {
      await institutions.unassign(caller(req), req.params.institutionId, req.params.assignmentId);
      return ok({});
    },
  );
  // ?batchId=&trackId=
  app.get<P<Inst>>(`${base}/institutions/:institutionId/report`, async (req) => {
    const q = parse(z.object({ batchId: z.string().min(1).max(100), trackId: z.string().min(1).max(100) }), req.query, "query");
    return ok(await institutions.report(caller(req), req.params.institutionId, q.batchId, q.trackId));
  });
  app.get<P<Inst>>(`${base}/institutions/:institutionId/audit`, async (req) =>
    ok(await institutions.auditLog(caller(req), req.params.institutionId, parse(PageQuerySchema, req.query, "query"))),
  );

  return { app, arena };
}
