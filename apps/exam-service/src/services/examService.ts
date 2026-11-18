import type {
  AttemptReview,
  ExamDetail,
  ExamDraftInput,
  ExamSummary,
  ResultRow,
} from "@logixai/contracts";
import { BadRequestError, ConflictError, NotFoundError } from "@logixai/service-kit";
import { examPhase, isAssigned, isStaff, totalMarks, validateExam } from "../lib/rules.js";
import type { AttemptRecord, ExamRecord } from "../store/types.js";
import { buildResult } from "./results.js";
import { loadExamFor, requireMember, requireStaff, type Caller, type Deps } from "./context.js";

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export function toSummary(exam: ExamRecord, attempt?: AttemptRecord | null, now = new Date()): ExamSummary {
  return {
    id: exam.id,
    institutionId: exam.institutionId,
    title: exam.title,
    instructions: exam.instructions,
    status: exam.status,
    phase: examPhase(exam, now),
    durationMinutes: exam.durationMinutes,
    startsAt: iso(exam.startsAt),
    endsAt: iso(exam.endsAt),
    batchIds: exam.batchIds,
    questionCount: exam.questions.length,
    totalMarks: totalMarks(exam.questions),
    proctoring: {
      requireFullscreen: exam.settings.requireFullscreen,
      blockCopyPaste: exam.settings.blockCopyPaste,
    },
    createdAt: exam.createdAt.toISOString(),
    ...(attempt
      ? {
          myAttempt: {
            id: attempt.id,
            status: attempt.status,
            score: attempt.status === "in_progress" ? null : attempt.score,
            maxScore: attempt.maxScore,
          },
        }
      : {}),
  };
}

export class ExamService {
  constructor(private readonly deps: Deps) {}

  async create(caller: Caller, institutionId: string, title: string): Promise<ExamDetail> {
    requireStaff(await requireMember(this.deps, caller, institutionId));
    const exam = await this.deps.store.exams.create({
      institutionId,
      title,
      instructions: "",
      durationMinutes: 60,
      startsAt: null,
      endsAt: null,
      batchIds: [],
      settings: {
        shuffleQuestions: false,
        shuffleOptions: false,
        requireFullscreen: true,
        blockCopyPaste: true,
        resultsVisibility: "after_end",
      },
      questions: [],
      status: "draft",
      createdBy: caller.userId,
      publishedAt: null,
    });
    return this.detail(exam, 0);
  }

  /** Staff see every exam; students see published exams assigned to their batches. */
  async list(caller: Caller, institutionId: string): Promise<ExamSummary[]> {
    const membership = await requireMember(this.deps, caller, institutionId);
    const exams = await this.deps.store.exams.listForInstitution(institutionId);
    if (isStaff(membership.role)) return exams.map((e) => toSummary(e));

    const visible = exams.filter(
      (e) => e.status === "published" && isAssigned(e, membership.batchIds),
    );
    const attempts = await this.deps.store.attempts.listForUser(
      caller.userId,
      visible.map((e) => e.id),
    );
    const byExam = new Map(attempts.map((a) => [a.examId, a]));
    return visible.map((e) => toSummary(e, byExam.get(e.id)));
  }

  async get(caller: Caller, examId: string): Promise<ExamSummary | ExamDetail> {
    const { exam, membership } = await loadExamFor(this.deps, caller, examId);
    if (isStaff(membership.role)) {
      return this.detail(exam, await this.deps.store.attempts.countForExam(exam.id));
    }
    if (exam.status !== "published" || !isAssigned(exam, membership.batchIds)) {
      throw new NotFoundError("Exam", examId);
    }
    return toSummary(exam, await this.deps.store.attempts.find(exam.id, caller.userId));
  }

  /** Replaces the draft. Published exams must be unpublished first. */
  async update(caller: Caller, examId: string, draft: ExamDraftInput): Promise<ExamDetail> {
    const { exam, membership } = await loadExamFor(this.deps, caller, examId);
    requireStaff(membership);
    if (exam.status !== "draft") {
      throw new ConflictError("Unpublish the exam before editing it.");
    }
    const updated = await this.deps.store.exams.update(exam.id, {
      title: draft.title,
      instructions: draft.instructions,
      durationMinutes: draft.durationMinutes,
      startsAt: draft.startsAt ? new Date(draft.startsAt) : null,
      endsAt: draft.endsAt ? new Date(draft.endsAt) : null,
      batchIds: [...new Set(draft.batchIds)],
      settings: draft.settings,
      questions: draft.questions,
    });
    return this.detail(updated!, 0);
  }

  async publish(caller: Caller, examId: string): Promise<ExamDetail> {
    const { exam, membership } = await loadExamFor(this.deps, caller, examId);
    requireStaff(membership);
    if (exam.status === "published") return this.detail(exam, await this.deps.store.attempts.countForExam(exam.id));
    const problems = validateExam(exam);
    if (problems.length) {
      throw new BadRequestError("exam", { reason: problems[0], problems });
    }
    const updated = await this.deps.store.exams.update(exam.id, {
      status: "published",
      publishedAt: new Date(),
    });
    return this.detail(updated!, 0);
  }

  async unpublish(caller: Caller, examId: string): Promise<ExamDetail> {
    const { exam, membership } = await loadExamFor(this.deps, caller, examId);
    requireStaff(membership);
    if ((await this.deps.store.attempts.countForExam(exam.id)) > 0) {
      throw new ConflictError("Students have already started this exam, so it can't be unpublished.");
    }
    const updated = await this.deps.store.exams.update(exam.id, { status: "draft", publishedAt: null });
    return this.detail(updated!, 0);
  }

  async remove(caller: Caller, examId: string): Promise<void> {
    const { exam, membership } = await loadExamFor(this.deps, caller, examId);
    requireStaff(membership);
    if ((await this.deps.store.attempts.countForExam(exam.id)) > 0) {
      throw new ConflictError("This exam has attempts, so it can't be deleted.");
    }
    await this.deps.store.exams.delete(exam.id);
  }

  async results(caller: Caller, examId: string): Promise<{ exam: ExamSummary; rows: ResultRow[] }> {
    const { exam, membership } = await loadExamFor(this.deps, caller, examId);
    requireStaff(membership);
    const [attempts, members] = await Promise.all([
      this.deps.store.attempts.listForExam(exam.id),
      this.deps.identity.listMembers(caller.authorization, exam.institutionId),
    ]);
    const people = new Map(members.map((m) => [m.userId, m]));
    const rows = attempts.map((a) => ({
      attemptId: a.id,
      userId: a.userId,
      name: people.get(a.userId)?.name ?? "Former member",
      email: people.get(a.userId)?.email ?? "",
      status: a.status,
      startedAt: a.startedAt.toISOString(),
      submittedAt: iso(a.submittedAt),
      score: a.status === "in_progress" ? null : a.score,
      maxScore: a.maxScore,
      proctorEventCount: a.proctorEvents.length,
    }));
    rows.sort((x, y) => (y.score ?? -1) - (x.score ?? -1) || x.name.localeCompare(y.name));
    return { exam: toSummary(exam), rows };
  }

  async review(caller: Caller, examId: string, attemptId: string): Promise<AttemptReview> {
    const { exam, membership } = await loadExamFor(this.deps, caller, examId);
    requireStaff(membership);
    const attempt = await this.deps.store.attempts.findById(attemptId);
    if (!attempt || attempt.examId !== exam.id) throw new NotFoundError("Attempt", attemptId);
    const members = await this.deps.identity.listMembers(caller.authorization, exam.institutionId);
    const person = members.find((m) => m.userId === attempt.userId);
    return {
      ...buildResult(exam, attempt, { includeAnswers: true }),
      student: {
        userId: attempt.userId,
        name: person?.name ?? "Former member",
        email: person?.email ?? "",
      },
      startedAt: attempt.startedAt.toISOString(),
      proctorEvents: attempt.proctorEvents.map((e) => ({ type: e.type, at: e.at.toISOString() })),
    };
  }

  private detail(exam: ExamRecord, attemptCount: number): ExamDetail {
    return {
      ...toSummary(exam),
      instructions: exam.instructions,
      settings: exam.settings,
      questions: exam.questions,
      attemptCount,
    };
  }
}
