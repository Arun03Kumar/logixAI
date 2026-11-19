import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import {
  BankQuerySchema,
  BankQuestionInputSchema,
  CreateExamSchema,
  ExamDraftSchema,
  ExtraTimeSchema,
  GradeAnswerSchema,
  GradingQuerySchema,
  PageQuerySchema,
  ProctorEventSchema,
  REEVALUATION_STATUSES,
  RequestReevaluationSchema,
  ResolveReevaluationSchema,
  SaveAnswerSchema,
} from "@logixai/contracts";
import {
  BadRequestError,
  errorResponse,
  successResponse,
  type AccessTokenVerifier,
  z,
} from "@logixai/service-kit";
import type { IdentityClient } from "./lib/identity.js";
import { AttemptService, type JudgeGateway } from "./services/attemptService.js";
import { BankService } from "./services/bankService.js";
import { GradingService } from "./services/gradingService.js";
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
  const grading = new GradingService(deps);
  const bank = new BankService(deps);
  const StatusQuery = z.object({ status: z.enum(REEVALUATION_STATUSES).optional() });

  await app.register(cors, {
    origin: options.corsOrigins,
    methods: ["GET", "POST", "PUT", "DELETE"],
    exposedHeaders: ["content-disposition"],
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
  // ?limit=&cursor= (best scores first)
  app.get<P<{ examId: string }>>("/api/v1/exams/:examId/results", async (req) =>
    ok(await exams.results(caller(req), req.params.examId, parse(PageQuerySchema, req.query, "query"))),
  );
  app.get<P<{ examId: string }>>("/api/v1/exams/:examId/results/export", async (req, reply) => {
    const { filename, csv } = await exams.resultsCsv(caller(req), req.params.examId);
    return reply
      .header("content-type", "text/csv; charset=utf-8")
      .header("content-disposition", `attachment; filename="${filename}"`)
      .header("cache-control", "no-store")
      .send(csv);
  });
  app.get<P<{ institutionId: string }>>("/api/v1/institutions/:institutionId/exam-audit", async (req) =>
    ok(await exams.auditLog(caller(req), req.params.institutionId, parse(PageQuerySchema, req.query, "query"))),
  );
  app.get<P<{ examId: string; attemptId: string }>>(
    "/api/v1/exams/:examId/attempts/:attemptId",
    async (req) => ok(await exams.review(caller(req), req.params.examId, req.params.attemptId)),
  );

  /* ── Grading, extra time, re-evaluation (staff) ── */
  app.get<P<{ examId: string }>>("/api/v1/exams/:examId/grading", async (req) =>
    ok(await grading.overview(caller(req), req.params.examId)),
  );
  // ?show=ungraded|all&limit=&cursor=
  app.get<P<{ examId: string; questionId: string }>>("/api/v1/exams/:examId/grading/:questionId", async (req) =>
    ok(
      await grading.queue(
        caller(req),
        req.params.examId,
        req.params.questionId,
        parse(GradingQuerySchema, req.query, "query"),
      ),
    ),
  );
  app.put<P<{ examId: string; attemptId: string; questionId: string }>>(
    "/api/v1/exams/:examId/attempts/:attemptId/grades/:questionId",
    async (req) =>
      ok(
        await grading.grade(
          caller(req),
          req.params.examId,
          req.params.attemptId,
          req.params.questionId,
          parse(GradeAnswerSchema, req.body, "grade"),
        ),
      ),
  );
  app.put<P<{ examId: string }>>("/api/v1/exams/:examId/extra-time", async (req) =>
    ok(await grading.setExtraTime(caller(req), req.params.examId, parse(ExtraTimeSchema, req.body, "extraTime"))),
  );
  // ?status=open|resolved
  app.get<P<{ examId: string }>>("/api/v1/exams/:examId/reevaluations", async (req) =>
    ok(await grading.listReevaluations(caller(req), req.params.examId, parse(StatusQuery, req.query, "query").status)),
  );
  app.post<P<{ examId: string; requestId: string }>>(
    "/api/v1/exams/:examId/reevaluations/:requestId/resolve",
    async (req) =>
      ok(
        await grading.resolveReevaluation(
          caller(req),
          req.params.examId,
          req.params.requestId,
          parse(ResolveReevaluationSchema, req.body, "reevaluation"),
        ),
      ),
  );

  /* ── Question bank (staff who set exams) ── */
  // ?q=&tag=&type=&difficulty=&limit=&cursor=
  app.get<P<{ institutionId: string }>>("/api/v1/institutions/:institutionId/question-bank", async (req) =>
    ok(await bank.list(caller(req), req.params.institutionId, parse(BankQuerySchema, req.query, "query"))),
  );
  app.post<P<{ institutionId: string }>>("/api/v1/institutions/:institutionId/question-bank", async (req, reply) =>
    reply
      .status(201)
      .send(ok(await bank.create(caller(req), req.params.institutionId, parse(BankQuestionInputSchema, req.body, "question")))),
  );
  app.put<P<{ institutionId: string; id: string }>>(
    "/api/v1/institutions/:institutionId/question-bank/:id",
    async (req) =>
      ok(
        await bank.update(
          caller(req),
          req.params.institutionId,
          req.params.id,
          parse(BankQuestionInputSchema, req.body, "question"),
        ),
      ),
  );
  app.delete<P<{ institutionId: string; id: string }>>(
    "/api/v1/institutions/:institutionId/question-bank/:id",
    async (req) => {
      await bank.remove(caller(req), req.params.institutionId, req.params.id);
      return ok({});
    },
  );

  /* ── Taking (students) ── */
  app.post<P<{ examId: string }>>("/api/v1/exams/:examId/attempts", async (req) =>
    ok(await attempts.start(caller(req), req.params.examId)),
  );
  app.get<P<{ examId: string }>>("/api/v1/exams/:examId/my-result", async (req) =>
    ok(await attempts.myResult(caller(req), req.params.examId)),
  );
  app.post<P<{ examId: string }>>("/api/v1/exams/:examId/my-result/reevaluations", async (req, reply) =>
    reply
      .status(201)
      .send(
        ok(
          await attempts.requestReevaluation(
            caller(req),
            req.params.examId,
            parse(RequestReevaluationSchema, req.body, "reevaluation"),
          ),
        ),
      ),
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
