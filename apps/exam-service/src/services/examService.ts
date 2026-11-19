import type {
  AttemptReview,
  AuditAction,
  AuditEvent,
  ExamDetail,
  ExamDraftInput,
  ExamResultsPage,
  ExamSummary,
  ResultRow,
} from "@logixai/contracts";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "@logixai/service-kit";
import { examPhase, extraMinutes, hasWritten, isAssigned, totalMarks, validateExam } from "../lib/rules.js";
import type { AttemptRecord, AttemptRow, ExamRecord, Page } from "../store/types.js";
import { buildResult } from "./results.js";
import {
  canSeeExam,
  isStaffView,
  loadExamFor,
  requireCapability,
  requireExam,
  requireMember,
  type Caller,
  type Deps,
} from "./context.js";

const iso = (d: Date | null) => (d ? d.toISOString() : null);

/**
 * Quotes a CSV cell. Cells starting with = + - @ get a leading apostrophe so a
 * student named "=HYPERLINK(...)" can't run a formula in the teacher's Excel.
 */
function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

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
    hasWritten: hasWritten(exam),
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
    requireCapability(await requireMember(this.deps, caller, institutionId), "tests.manage");
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
        showRank: false,
        reevaluationDays: 0,
      },
      sections: [],
      questions: [],
      extraTime: {},
      status: "draft",
      createdBy: caller.userId,
      publishedAt: null,
    });
    await this.audit(caller, "exam.created", exam);
    return this.detail(exam, 0);
  }

  /** Staff see the exams in their scope; students see published exams assigned to their batches. */
  async list(caller: Caller, institutionId: string): Promise<ExamSummary[]> {
    const membership = await requireMember(this.deps, caller, institutionId);
    const exams = await this.deps.store.exams.listForInstitution(institutionId);
    if (isStaffView(membership)) {
      return exams.filter((e) => canSeeExam(membership, e, caller.userId)).map((e) => toSummary(e));
    }

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
    if (isStaffView(membership)) {
      requireExam(membership, exam, caller, "reports.view");
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
    requireExam(membership, exam, caller, "tests.manage");
    if (exam.status !== "draft") {
      throw new ConflictError("Unpublish the exam before editing it.");
    }
    const batchIds = [...new Set(draft.batchIds)];
    if (!membership.scope.all) {
      // Staff limited to some batches can only set exams for those batches.
      if (!batchIds.length) throw new BadRequestError("batchIds", { reason: "Choose which of your batches take this exam." });
      if (batchIds.some((b) => !membership.scope.batchIds.includes(b))) {
        throw new ForbiddenError("You can only set exams for your own batches.");
      }
    }
    // Without the proctoring feature, the browser checks are off.
    const settings = membership.features.proctoring
      ? draft.settings
      : { ...draft.settings, requireFullscreen: false, blockCopyPaste: false };
    const updated = await this.deps.store.exams.update(exam.id, {
      title: draft.title,
      instructions: draft.instructions,
      durationMinutes: draft.durationMinutes,
      startsAt: draft.startsAt ? new Date(draft.startsAt) : null,
      endsAt: draft.endsAt ? new Date(draft.endsAt) : null,
      batchIds,
      settings,
      sections: draft.sections,
      questions: draft.questions,
    });
    await this.audit(caller, "exam.updated", updated!, { questionCount: draft.questions.length });
    return this.detail(updated!, 0);
  }

  async publish(caller: Caller, examId: string): Promise<ExamDetail> {
    const { exam, membership } = await loadExamFor(this.deps, caller, examId);
    requireExam(membership, exam, caller, "tests.manage");
    if (exam.status === "published") return this.detail(exam, await this.deps.store.attempts.countForExam(exam.id));
    const problems = validateExam(exam);
    if (hasWritten(exam) && !membership.features.subjective) {
      problems.unshift("Written answers aren't switched on for this institution. Remove the short and long answer questions, or contact LogixAI.");
    }
    if (problems.length) {
      throw new BadRequestError("exam", { reason: problems[0], problems });
    }
    const updated = await this.deps.store.exams.update(exam.id, {
      status: "published",
      publishedAt: new Date(),
    });
    await this.audit(caller, "exam.published", updated!);
    return this.detail(updated!, 0);
  }

  async unpublish(caller: Caller, examId: string): Promise<ExamDetail> {
    const { exam, membership } = await loadExamFor(this.deps, caller, examId);
    requireExam(membership, exam, caller, "tests.manage");
    if ((await this.deps.store.attempts.countForExam(exam.id)) > 0) {
      throw new ConflictError("Students have already started this exam, so it can't be unpublished.");
    }
    const updated = await this.deps.store.exams.update(exam.id, { status: "draft", publishedAt: null });
    await this.audit(caller, "exam.unpublished", updated!);
    return this.detail(updated!, 0);
  }

  async remove(caller: Caller, examId: string): Promise<void> {
    const { exam, membership } = await loadExamFor(this.deps, caller, examId);
    requireExam(membership, exam, caller, "tests.manage");
    if ((await this.deps.store.attempts.countForExam(exam.id)) > 0) {
      throw new ConflictError("This exam has attempts, so it can't be deleted.");
    }
    await this.deps.store.exams.delete(exam.id);
    await this.audit(caller, "exam.deleted", exam);
  }

  /** One page of results (best first) plus whole-exam numbers from the database. */
  async results(
    caller: Caller,
    examId: string,
    query: { limit: number; cursor?: string },
  ): Promise<ExamResultsPage> {
    const { exam, membership } = await loadExamFor(this.deps, caller, examId);
    requireExam(membership, exam, caller, "reports.view");
    const [page, summary, openReevaluations] = await Promise.all([
      this.deps.store.attempts.pageForExam(exam.id, query),
      this.deps.store.attempts.summarizeExam(exam.id),
      this.deps.store.reevaluations.countOpen(exam.id),
    ]);
    return {
      exam: toSummary(exam),
      summary: { ...summary, openReevaluations },
      items: await this.toRows(caller, exam.institutionId, page.items),
      nextCursor: page.nextCursor,
    };
  }

  /** Every result as CSV, read from the database a page at a time. */
  async resultsCsv(caller: Caller, examId: string): Promise<{ filename: string; csv: string }> {
    const { exam, membership } = await loadExamFor(this.deps, caller, examId);
    requireExam(membership, exam, caller, "reports.view");
    const lines = [
      ["Rank", "Name", "Roll number", "Email", "Status", "Score", "Max score", "Started at", "Submitted at", "Proctoring events"],
    ];
    let cursor: string | undefined;
    let rank = 0;
    do {
      const page: Page<AttemptRow> = await this.deps.store.attempts.pageForExam(exam.id, {
        limit: 100,
        ...(cursor ? { cursor } : {}),
      });
      for (const row of await this.toRows(caller, exam.institutionId, page.items)) {
        rank += 1;
        lines.push([
          String(rank),
          row.name,
          row.rollNumber ?? "",
          row.email,
          row.status,
          row.score === null ? "" : String(row.score),
          String(row.maxScore),
          row.startedAt,
          row.submittedAt ?? "",
          String(row.proctorEventCount),
        ]);
      }
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    const slug = exam.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "exam";
    return { filename: `${slug}-results.csv`, csv: lines.map((l) => l.map(csvCell).join(",")).join("\r\n") + "\r\n" };
  }

  /** Exam changes in an institution, newest first. Admins and owners only. */
  async auditLog(caller: Caller, institutionId: string, query: { limit: number; cursor?: string }): Promise<Page<AuditEvent>> {
    const membership = await requireMember(this.deps, caller, institutionId);
    if (!membership.capabilities.includes("audit.view")) throw new ForbiddenError("Only admins can see the audit log.");
    return this.deps.store.audit.pageForInstitution(institutionId, query);
  }

  private async toRows(caller: Caller, institutionId: string, attempts: AttemptRow[]): Promise<ResultRow[]> {
    const members = attempts.length
      ? await this.deps.identity.lookupMembers(
          caller.authorization,
          institutionId,
          attempts.map((a) => a.userId),
        )
      : [];
    const people = new Map(members.map((m) => [m.userId, m]));
    return attempts.map((a) => ({
      attemptId: a.id,
      userId: a.userId,
      name: people.get(a.userId)?.name ?? "Former member",
      email: people.get(a.userId)?.email ?? "",
      rollNumber: people.get(a.userId)?.rollNumber ?? null,
      status: a.status,
      startedAt: a.startedAt.toISOString(),
      submittedAt: iso(a.submittedAt),
      score: a.status === "in_progress" ? null : a.score,
      maxScore: a.maxScore,
      proctorEventCount: a.proctorEventCount,
    }));
  }

  async review(caller: Caller, examId: string, attemptId: string): Promise<AttemptReview> {
    const { exam, membership } = await loadExamFor(this.deps, caller, examId);
    requireExam(membership, exam, caller, "reports.view");
    const attempt = await this.deps.store.attempts.findById(attemptId);
    if (!attempt || attempt.examId !== exam.id) throw new NotFoundError("Attempt", attemptId);
    const [[person], reevaluations] = await Promise.all([
      this.deps.identity.lookupMembers(caller.authorization, exam.institutionId, [attempt.userId]),
      this.deps.store.reevaluations.listForAttempt(attempt.id),
    ]);
    return {
      ...buildResult(exam, attempt, { includeAnswers: true, staff: true, reevaluations }),
      student: {
        userId: attempt.userId,
        name: person?.name ?? "Former member",
        email: person?.email ?? "",
        rollNumber: person?.rollNumber ?? null,
      },
      startedAt: attempt.startedAt.toISOString(),
      extraMinutes: extraMinutes(exam, attempt.userId),
      proctorEvents: attempt.proctorEvents.map((e) => ({ type: e.type, at: e.at.toISOString() })),
    };
  }

  /** Best effort: a failed audit write never fails the change itself. */
  private async audit(caller: Caller, action: AuditAction, exam: ExamRecord, meta: Record<string, unknown> = {}) {
    await this.deps.store.audit
      .record({
        actorId: caller.userId,
        action,
        institutionId: exam.institutionId,
        targetType: "exam",
        targetId: exam.id,
        meta: { title: exam.title, ...meta },
      })
      .catch(() => {});
  }

  private detail(exam: ExamRecord, attemptCount: number): ExamDetail {
    return {
      ...toSummary(exam),
      instructions: exam.instructions,
      settings: { ...exam.settings, showRank: exam.settings.showRank ?? false, reevaluationDays: exam.settings.reevaluationDays ?? 0 },
      sections: exam.sections ?? [],
      questions: exam.questions,
      extraTime: exam.extraTime ?? {},
      attemptCount,
    };
  }
}
