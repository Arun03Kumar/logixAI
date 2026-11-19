import {
  isWrittenType,
  type AuditAction,
  type ExamQuestion,
  type GradeAnswerInput,
  type GradeResult,
  type GradingOverview,
  type GradingPage,
  type ReevaluationRow,
  type ReevaluationStatus,
  type WrittenQuestion,
} from "@logixai/contracts";
import { BadRequestError, ConflictError, NotFoundError } from "@logixai/service-kit";
import { computeScores, deadlineFor } from "../lib/rules.js";
import type { AttemptRecord, ExamRecord, GradeRecord } from "../store/types.js";
import { loadExamFor, requireExam, type Caller, type Deps } from "./context.js";
import { toSummary } from "./examService.js";
import { toAnswerView, toGradeView, toReevaluationView } from "./results.js";

const isWritten = (q: ExamQuestion): q is WrittenQuestion => isWrittenType(q.type);

/**
 * Marking by people: the grading queue for written answers, grade overrides
 * on any question, extra time, and re-evaluation requests.
 */
export class GradingService {
  constructor(private readonly deps: Deps) {}

  /** Written questions with how many answers are in and graded. */
  async overview(caller: Caller, examId: string): Promise<GradingOverview> {
    const { exam } = await this.load(caller, examId, "tests.grade");
    const written = exam.questions.filter(isWritten);
    const [counts, openReevaluations] = await Promise.all([
      this.deps.store.attempts.gradingCounts(exam.id, written.map((q) => q.id)),
      this.deps.store.reevaluations.countOpen(exam.id),
    ]);
    return {
      exam: toSummary(exam),
      sections: exam.sections ?? [],
      questions: written.map((q) => ({
        questionId: q.id,
        type: q.type,
        prompt: q.prompt,
        marks: q.marks,
        sectionId: q.sectionId ?? null,
        answered: counts[q.id]?.answered ?? 0,
        graded: counts[q.id]?.graded ?? 0,
      })),
      openReevaluations,
    };
  }

  /** Answers to one written question, oldest submission first. */
  async queue(
    caller: Caller,
    examId: string,
    questionId: string,
    query: { show: "ungraded" | "all"; limit: number; cursor?: string },
  ): Promise<GradingPage> {
    const { exam } = await this.load(caller, examId, "tests.grade");
    const question = exam.questions.find((q) => q.id === questionId);
    if (!question || !isWritten(question)) throw new NotFoundError("Question", questionId);
    const page = await this.deps.store.attempts.pageForGrading(exam.id, questionId, {
      ungradedOnly: query.show === "ungraded",
      limit: query.limit,
      ...(query.cursor ? { cursor: query.cursor } : {}),
    });
    const [people, open] = await Promise.all([
      this.people(caller, exam, page.items.map((a) => a.userId)),
      this.deps.store.reevaluations.listForExam(exam.id, "open"),
    ]);
    const requests = new Map(open.filter((r) => r.questionId === questionId).map((r) => [r.attemptId, r]));
    return {
      question,
      items: page.items.map((a) => {
        const grade = a.grades?.[questionId];
        const request = requests.get(a.id);
        return {
          attemptId: a.id,
          userId: a.userId,
          name: people.get(a.userId)?.name ?? "Former member",
          rollNumber: people.get(a.userId)?.rollNumber ?? null,
          answer: toAnswerView(a.answers[questionId]!),
          grade: grade ? toGradeView(grade, { staff: true }) : null,
          ...(request ? { reevaluation: toReevaluationView(request) } : {}),
        };
      }),
      nextCursor: page.nextCursor,
    };
  }

  /** Grades one answer (or, with marks null, goes back to the automatic score). */
  async grade(
    caller: Caller,
    examId: string,
    attemptId: string,
    questionId: string,
    input: GradeAnswerInput,
  ): Promise<GradeResult> {
    const { exam } = await this.load(caller, examId, "tests.grade");
    const attempt = await this.finalAttempt(exam, attemptId);
    const question = exam.questions.find((q) => q.id === questionId);
    if (!question) throw new NotFoundError("Question", questionId);
    const previous = attempt.scores?.[questionId] ?? null;
    const updated = await this.applyGrade(caller, exam, attempt, question, input);
    await this.audit(caller, "exam.answer_graded", exam, attempt.id, {
      questionId,
      marks: input.marks,
      previous,
    });
    const grade = updated.grades?.[questionId];
    return {
      attemptId: attempt.id,
      questionId,
      questionScore: updated.scores?.[questionId] ?? null,
      score: updated.score,
      grade: grade ? toGradeView(grade, { staff: true }) : null,
    };
  }

  /** Extra minutes for one student; moves their deadline if they're writing now. */
  async setExtraTime(
    caller: Caller,
    examId: string,
    input: { userId: string; minutes: number },
  ): Promise<{ extraTime: Record<string, number> }> {
    const { exam } = await this.load(caller, examId, "tests.manage");
    const [person] = await this.deps.identity.lookupMembers(caller.authorization, exam.institutionId, [input.userId]);
    if (!person || person.role !== "student") throw new NotFoundError("Student", input.userId);

    const extraTime = { ...(exam.extraTime ?? {}) };
    if (input.minutes > 0) extraTime[input.userId] = input.minutes;
    else delete extraTime[input.userId];
    await this.deps.store.exams.update(exam.id, { extraTime });

    const attempt = await this.deps.store.attempts.find(exam.id, input.userId);
    if (attempt?.status === "in_progress") {
      await this.deps.store.attempts.setDeadline(attempt.id, deadlineFor(exam, attempt.startedAt, input.minutes));
    }
    await this.audit(caller, "exam.extra_time_set", exam, exam.id, { userId: input.userId, minutes: input.minutes }, "exam");
    return { extraTime };
  }

  async listReevaluations(caller: Caller, examId: string, status?: ReevaluationStatus): Promise<ReevaluationRow[]> {
    const { exam } = await this.load(caller, examId, "tests.grade");
    const requests = await this.deps.store.reevaluations.listForExam(exam.id, status);
    const people = await this.people(caller, exam, requests.map((r) => r.userId));
    const attempts = new Map<string, AttemptRecord | null>();
    for (const r of requests) {
      if (!attempts.has(r.attemptId)) attempts.set(r.attemptId, await this.deps.store.attempts.findById(r.attemptId));
    }
    const questions = new Map(exam.questions.map((q) => [q.id, q]));
    return requests.map((r) => ({
      ...toReevaluationView(r),
      attemptId: r.attemptId,
      userId: r.userId,
      name: people.get(r.userId)?.name ?? "Former member",
      rollNumber: people.get(r.userId)?.rollNumber ?? null,
      questionPrompt: questions.get(r.questionId)?.prompt ?? "(question removed)",
      questionMarks: questions.get(r.questionId)?.marks ?? 0,
      currentScore: attempts.get(r.attemptId)?.scores?.[r.questionId] ?? null,
    }));
  }

  /** Replies to a request, optionally with new marks for the question. */
  async resolveReevaluation(
    caller: Caller,
    examId: string,
    requestId: string,
    input: { response: string; marks?: number | undefined },
  ): Promise<ReevaluationRow> {
    const { exam } = await this.load(caller, examId, "tests.grade");
    const request = await this.deps.store.reevaluations.findById(requestId);
    if (!request || request.examId !== exam.id) throw new NotFoundError("Re-evaluation request", requestId);
    if (request.status !== "open") throw new ConflictError("This request has already been answered.");
    let attempt = await this.finalAttempt(exam, request.attemptId);
    const question = exam.questions.find((q) => q.id === request.questionId);
    if (input.marks !== undefined) {
      if (!question) throw new NotFoundError("Question", request.questionId);
      const current = attempt.grades?.[question.id];
      attempt = await this.applyGrade(caller, exam, attempt, question, {
        marks: input.marks,
        rubricIds: current?.rubricIds ?? [],
        comment: current?.comment ?? "",
      });
    }
    const ok = await this.deps.store.reevaluations.resolve(request.id, {
      response: input.response,
      scoreAfter: attempt.scores?.[request.questionId] ?? null,
      resolvedBy: caller.userId,
      resolvedAt: new Date(),
    });
    if (!ok) throw new ConflictError("This request has already been answered.");
    await this.audit(caller, "exam.reevaluation_resolved", exam, attempt.id, {
      questionId: request.questionId,
      before: request.scoreBefore,
      after: attempt.scores?.[request.questionId] ?? null,
    });
    const [row] = (await this.listReevaluations(caller, examId)).filter((r) => r.id === request.id);
    return row!;
  }

  /* ── internals ── */

  private async load(caller: Caller, examId: string, capability: "tests.grade" | "tests.manage") {
    const { exam, membership } = await loadExamFor(this.deps, caller, examId);
    requireExam(membership, exam, caller, capability);
    return { exam, membership };
  }

  private async finalAttempt(exam: ExamRecord, attemptId: string): Promise<AttemptRecord> {
    const attempt = await this.deps.store.attempts.findById(attemptId);
    if (!attempt || attempt.examId !== exam.id) throw new NotFoundError("Attempt", attemptId);
    if (attempt.status === "in_progress") throw new ConflictError("The student is still writing this exam.");
    return attempt;
  }

  private async applyGrade(
    caller: Caller,
    exam: ExamRecord,
    attempt: AttemptRecord,
    question: ExamQuestion,
    input: GradeAnswerInput,
  ): Promise<AttemptRecord> {
    let grade: GradeRecord | null = null;
    if (input.marks !== null) {
      if (input.marks > question.marks) {
        throw new BadRequestError("marks", { reason: `This question is out of ${question.marks}.` });
      }
      const rubric = new Set(isWritten(question) ? question.rubric.map((r) => r.id) : []);
      const rubricIds = [...new Set(input.rubricIds)];
      if (rubricIds.some((id) => !rubric.has(id))) {
        throw new BadRequestError("rubricIds", { reason: "Unknown rubric point." });
      }
      grade = { marks: input.marks, rubricIds, comment: input.comment, gradedBy: caller.userId, gradedAt: new Date() };
    }
    const updated = await this.deps.store.attempts.setGrade(attempt.id, question.id, grade);
    if (!updated) throw new NotFoundError("Attempt", attempt.id);
    const { scores, score } = computeScores(exam, updated.answers, updated.grades);
    await this.deps.store.attempts.setScores(updated.id, scores, score);
    return { ...updated, scores, score };
  }

  private async people(caller: Caller, exam: ExamRecord, userIds: string[]) {
    const members = userIds.length
      ? await this.deps.identity.lookupMembers(caller.authorization, exam.institutionId, userIds)
      : [];
    return new Map(members.map((m) => [m.userId, m]));
  }

  /** Best effort, like every audit write. Never stores answers or comments. */
  private async audit(
    caller: Caller,
    action: AuditAction,
    exam: ExamRecord,
    targetId: string,
    meta: Record<string, unknown>,
    targetType: "attempt" | "exam" = "attempt",
  ) {
    await this.deps.store.audit
      .record({
        actorId: caller.userId,
        action,
        institutionId: exam.institutionId,
        targetType,
        targetId,
        meta: { examId: exam.id, title: exam.title, ...meta },
      })
      .catch(() => {});
  }
}
