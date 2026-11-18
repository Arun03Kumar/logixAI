import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import {
  CreateExamSchema,
  ExamDraftSchema,
  ProctorEventSchema,
  SaveAnswerSchema,
} from "@logixai/contracts";
import {
  BadRequestError,
  errorResponse,
  successResponse,
  type AccessTokenVerifier,
  type z,
} from "@logixai/service-kit";
import type { IdentityClient } from "./lib/identity.js";
import { AttemptService, type JudgeGateway } from "./services/attemptService.js";
import type { Caller } from "./services/context.js";
import { ExamService } from "./services/examService.js";
import type { Store } from "./store/types.js";

export interface AppOptions {
  store: Store;
  identity: IdentityClient;
  judge: JudgeGateway;
  verifier: AccessTokenVerifier;
  corsOrigins: string[];
  logger?: boolean;
}

function parse<S extends z.ZodType>(schema: S, body: unknown, name: string): z.infer<S> {
  const result = schema.safeParse(body ?? {});
  if (!result.success) throw new BadRequestError(name, result.error.issues);
  return result.data;
}

export async function buildApp(
  options: AppOptions,
): Promise<{ app: FastifyInstance; attempts: AttemptService }> {
  const app = Fastify({ logger: options.logger ?? false, bodyLimit: 2 * 1024 * 1024 });
  const deps = { store: options.store, identity: options.identity };
  const exams = new ExamService(deps);
  const attempts = new AttemptService({ ...deps, judge: options.judge });

  await app.register(cors, {
    origin: options.corsOrigins,
    methods: ["GET", "POST", "PUT", "DELETE"],
  });

  app.setErrorHandler((err: Error & { statusCode?: number }, request, reply) => {
    const status = err.statusCode;
    if (typeof status === "number" && status < 500 && !("details" in err)) {
      return reply.status(status).send({ success: false, message: err.message, error: {}, data: {} });
    }
    const { statusCode, body } = errorResponse(err);
    if (statusCode >= 500) request.log.error(err);
    return reply.status(statusCode).send(body);
  });

  /** Every route needs a signed-in user. */
  app.addHook("preHandler", async (request) => {
    if (request.url === "/ping") return;
    const claims = await options.verifier.verifyHeader(request.headers.authorization);
    (request as FastifyRequest & { caller: Caller }).caller = {
      userId: claims.sub,
      authorization: request.headers.authorization!,
    };
  });
  const caller = (request: FastifyRequest) => (request as FastifyRequest & { caller: Caller }).caller;

  type P<T> = { Params: T };
  const ok = <T>(data: T) => successResponse(data);

  app.get("/ping", async () => ({ message: "exam service is alive" }));

  /* ── Authoring (instructors and admins) ── */
  app.get<P<{ institutionId: string }>>("/api/v1/institutions/:institutionId/exams", async (req) =>
    ok(await exams.list(caller(req), req.params.institutionId)),
  );
  app.post<P<{ institutionId: string }>>(
    "/api/v1/institutions/:institutionId/exams",
    async (req, reply) => {
      const { title } = parse(CreateExamSchema, req.body, "exam");
      return reply.status(201).send(ok(await exams.create(caller(req), req.params.institutionId, title)));
    },
  );
  app.get<P<{ examId: string }>>("/api/v1/exams/:examId", async (req) =>
    ok(await exams.get(caller(req), req.params.examId)),
  );
  app.put<P<{ examId: string }>>("/api/v1/exams/:examId", async (req) =>
    ok(await exams.update(caller(req), req.params.examId, parse(ExamDraftSchema, req.body, "exam"))),
  );
  app.delete<P<{ examId: string }>>("/api/v1/exams/:examId", async (req) => {
    await exams.remove(caller(req), req.params.examId);
    return ok({});
  });
  app.post<P<{ examId: string }>>("/api/v1/exams/:examId/publish", async (req) =>
    ok(await exams.publish(caller(req), req.params.examId)),
  );
  app.post<P<{ examId: string }>>("/api/v1/exams/:examId/unpublish", async (req) =>
    ok(await exams.unpublish(caller(req), req.params.examId)),
  );
  app.get<P<{ examId: string }>>("/api/v1/exams/:examId/results", async (req) =>
    ok(await exams.results(caller(req), req.params.examId)),
  );
  app.get<P<{ examId: string; attemptId: string }>>(
    "/api/v1/exams/:examId/attempts/:attemptId",
    async (req) => ok(await exams.review(caller(req), req.params.examId, req.params.attemptId)),
  );

  /* ── Taking (students) ── */
  app.post<P<{ examId: string }>>("/api/v1/exams/:examId/attempts", async (req) =>
    ok(await attempts.start(caller(req), req.params.examId)),
  );
  app.get<P<{ examId: string }>>("/api/v1/exams/:examId/my-result", async (req) =>
    ok(await attempts.myResult(caller(req), req.params.examId)),
  );
  app.get<P<{ attemptId: string }>>("/api/v1/attempts/:attemptId", async (req) =>
    ok(await attempts.get(caller(req), req.params.attemptId)),
  );
  app.put<P<{ attemptId: string; questionId: string }>>(
    "/api/v1/attempts/:attemptId/answers/:questionId",
    async (req) =>
      ok(
        await attempts.saveAnswer(
          caller(req),
          req.params.attemptId,
          req.params.questionId,
          parse(SaveAnswerSchema, req.body, "answer"),
        ),
      ),
  );
  app.post<P<{ attemptId: string; questionId: string }>>(
    "/api/v1/attempts/:attemptId/answers/:questionId/run",
    async (req) => ok(await attempts.run(caller(req), req.params.attemptId, req.params.questionId)),
  );
  app.post<P<{ attemptId: string }>>("/api/v1/attempts/:attemptId/events", async (req) => {
    const { type } = parse(ProctorEventSchema, req.body, "event");
    await attempts.recordEvent(caller(req), req.params.attemptId, type);
    return ok({});
  });
  app.post<P<{ attemptId: string }>>("/api/v1/attempts/:attemptId/submit", async (req) =>
    ok(await attempts.submit(caller(req), req.params.attemptId)),
  );

  return { app, attempts };
}
