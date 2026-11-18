import type {
  AttemptResult,
  AttemptView,
  CodingQuestion,
  EvaluationJobPayload,
  ExecutionResponse,
  ExamQuestion,
  LanguageId,
  ProctorEventType,
  SaveAnswerInput,
  StudentQuestion,
} from "@logixai/contracts";
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "@logixai/service-kit";
import {
  SAVE_GRACE_MS,
  allTests,
  codeHash,
  examPhase,
  isAssigned,
  round2,
  scoreQuestion,
  shuffle,
  totalMarks,
} from "../lib/rules.js";
import type { AnswerRecord, AttemptRecord, ExamRecord, JudgeRecord } from "../store/types.js";
import { loadExamFor, type Caller, type Deps } from "./context.js";
import { buildResult, toAnswerView } from "./results.js";

const MAX_PROCTOR_EVENTS = 500;
/** A run that hasn't answered within this time may be retried. */
const JUDGE_RETRY_AFTER_MS = 60_000;

export interface JudgeRequest {
  submissionId: string;
  userId: string;
  code: string;
  language: LanguageId;
  testCases: { input: string; output: string }[];
}

/** Sends code to the shared judge; results come back via applyJudgeResult. */
export interface JudgeGateway {
  submit(request: JudgeRequest): Promise<void>;
}

const VERDICT_TEXT: Partial<Record<ExecutionResponse["status"], string>> = {
  WA: "Wrong answer",
  TLE: "Time limit exceeded",
  MLE: "Memory limit exceeded",
  RE: "Runtime error",
};

/**
 * What the student sees about a run. Compile errors and failures on the
 * visible examples include details; a hidden test only reveals its verdict,
 * never its output, so hidden tests can't be reverse-engineered.
 */
export function judgeMessage(results: ExecutionResponse[], sampleCount: number): string | undefined {
  if (results.length === 1 && results[0]!.status === "CE") {
    return `Compilation error:\n${results[0]!.output}`.slice(0, 2000);
  }
  if (results.some((r) => r.status === "ERROR")) {
    return "The judge hit a problem running your code. Run it again; it will also be re-run when you submit.";
  }
  const index = results.findIndex((r) => r.status !== "SUCCESS");
  if (index === -1) return undefined;
  const failure = results[index]!;
  const verdict = VERDICT_TEXT[failure.status] ?? failure.status;
  if (index < sampleCount) {
    const detail = failure.status === "RE" && failure.output ? `\n${failure.output}` : "";
    return `${verdict} on example ${index + 1}.${detail}`.slice(0, 2000);
  }
  return `${verdict} on a hidden test.`;
}

/** submissionId = "<attemptId>:<questionId>:<timestamp>" so results can be routed back. */
const makeSubmissionId = (attemptId: string, questionId: string) =>
  `${attemptId}:${questionId}:${Date.now().toString(36)}`;

function parseSubmissionId(id: string): { attemptId: string; questionId: string } | null {
  const [attemptId, questionId] = id.split(":");
  return attemptId && questionId ? { attemptId, questionId } : null;
}

export class AttemptService {
  constructor(private readonly deps: Deps & { judge: JudgeGateway }) {}

  /** Starts the caller's attempt, or returns the one already in progress. */
  async start(caller: Caller, examId: string): Promise<AttemptView> {
    const { exam, membership } = await loadExamFor(this.deps, caller, examId);
    if (membership.role !== "student" || exam.status !== "published" || !isAssigned(exam, membership.batchIds)) {
      throw new ForbiddenError("This exam isn't assigned to you.");
    }

    const existing = await this.deps.store.attempts.find(exam.id, caller.userId);
    if (existing) return this.view(exam, await this.finalizeIfExpired(exam, existing));

    const now = new Date();
    const phase = examPhase(exam, now);
    if (phase === "upcoming") throw new BadRequestError("exam", { reason: "This exam hasn't opened yet." });
    if (phase !== "live") throw new BadRequestError("exam", { reason: "This exam has closed." });

    const deadline = new Date(
      Math.min(now.getTime() + exam.durationMinutes * 60_000, exam.endsAt!.getTime()),
    );
    const ids = exam.questions.map((q) => q.id);
    const optionOrder: Record<string, string[]> = {};
    for (const q of exam.questions) {
      if (q.type !== "coding") {
        const optionIds = q.options.map((o) => o.id);
        optionOrder[q.id] = exam.settings.shuffleOptions ? shuffle(optionIds) : optionIds;
      }
    }

    try {
      const attempt = await this.deps.store.attempts.create({
        examId: exam.id,
        institutionId: exam.institutionId,
        userId: caller.userId,
        status: "in_progress",
        startedAt: now,
        deadline,
        submittedAt: null,
        questionOrder: exam.settings.shuffleQuestions ? shuffle(ids) : ids,
        optionOrder,
        answers: {},
        scores: null,
        score: null,
        maxScore: totalMarks(exam.questions),
        proctorEvents: [],
      });
      return this.view(exam, attempt);
    } catch (err) {
      // Two tabs pressed "Start" at once: return the attempt the other one made.
      if ((err as { code?: number }).code === 11000) {
        const attempt = await this.deps.store.attempts.find(exam.id, caller.userId);
        if (attempt) return this.view(exam, attempt);
      }
      throw err;
    }
  }

  async get(caller: Caller, attemptId: string): Promise<AttemptView> {
    const { exam, attempt } = await this.load(caller, attemptId);
    return this.view(exam, await this.finalizeIfExpired(exam, attempt));
  }

  async saveAnswer(
    caller: Caller,
    attemptId: string,
    questionId: string,
    input: SaveAnswerInput,
  ): Promise<{ savedAt: string }> {
    const { exam, attempt } = await this.load(caller, attemptId);
    const question = exam.questions.find((q) => q.id === questionId);
    if (!question) throw new NotFoundError("Question", questionId);

    const savedAt = new Date();
    let answer: Partial<AnswerRecord>;
    if (question.type === "coding") {
      if (input.language && !question.languages.includes(input.language)) {
        throw new BadRequestError("language", { reason: "That language isn't allowed for this question." });
      }
      answer = {
        code: input.code ?? attempt.answers[questionId]?.code ?? "",
        language: input.language ?? attempt.answers[questionId]?.language ?? question.languages[0]!,
        savedAt,
      };
    } else {
      const valid = new Set(question.options.map((o) => o.id));
      const selected = [...new Set(input.selectedOptionIds ?? [])];
      if (selected.some((id) => !valid.has(id))) {
        throw new BadRequestError("selectedOptionIds", { reason: "Unknown option." });
      }
      if (question.type === "mcq_single" && selected.length > 1) {
        throw new BadRequestError("selectedOptionIds", { reason: "Choose one option." });
      }
      answer = { selectedOptionIds: selected, savedAt };
    }

    const ok = await this.deps.store.attempts.saveAnswer(
      attempt.id,
      questionId,
      answer,
      new Date(Date.now() - SAVE_GRACE_MS),
    );
    if (!ok) throw new ConflictError("Time is up. Your answers were submitted.");
    return { savedAt: savedAt.toISOString() };
  }

  /** Judges the saved code for a coding question. */
  async run(caller: Caller, attemptId: string, questionId: string): Promise<AttemptView> {
    const { exam, attempt } = await this.load(caller, attemptId);
    this.assertOpen(attempt);
    const question = exam.questions.find((q) => q.id === questionId);
    if (!question || question.type !== "coding") throw new NotFoundError("Question", questionId);
    const answer = attempt.answers[questionId];
    if (!answer?.code?.trim()) {
      throw new BadRequestError("code", { reason: "Write some code before running it." });
    }
    const judge = answer.judge;
    if (judge?.status === "pending" && Date.now() - judge.requestedAt.getTime() < JUDGE_RETRY_AFTER_MS) {
      throw new ConflictError("Your previous run is still being judged.");
    }
    await this.requestJudge(exam, attempt, question, answer);
    return this.get(caller, attemptId);
  }

  async recordEvent(caller: Caller, attemptId: string, type: ProctorEventType): Promise<void> {
    const { attempt } = await this.load(caller, attemptId);
    await this.deps.store.attempts.pushEvent(attempt.id, { type, at: new Date() }, MAX_PROCTOR_EVENTS);
  }

  async submit(caller: Caller, attemptId: string): Promise<AttemptView> {
    const { exam, attempt } = await this.load(caller, attemptId);
    if (attempt.status === "in_progress") {
      const late = Date.now() > attempt.deadline.getTime() + SAVE_GRACE_MS;
      await this.finalize(exam, attempt, late ? "auto_submitted" : "submitted");
    }
    return this.get(caller, attemptId);
  }

  /** The caller's own result, respecting the exam's visibility setting. */
  async myResult(caller: Caller, examId: string): Promise<AttemptResult> {
    const { exam } = await loadExamFor(this.deps, caller, examId);
    let attempt = await this.deps.store.attempts.find(exam.id, caller.userId);
    if (!attempt) throw new NotFoundError("Attempt", examId);
    attempt = await this.finalizeIfExpired(exam, attempt);
    if (attempt.status === "in_progress") {
      throw new BadRequestError("attempt", { reason: "Submit the exam to see your result." });
    }
    const visibility = exam.settings.resultsVisibility;
    const ended = examPhase(exam) === "ended";
    if (visibility === "hidden" || (visibility === "after_end" && !ended)) {
      const result = buildResult(exam, attempt, { includeAnswers: false });
      // Submitted, but scores aren't released yet.
      return {
        ...result,
        released: false,
        score: null,
        questions: result.questions.map((q) => ({ ...q, score: null })),
      };
    }
    return buildResult(exam, attempt, { includeAnswers: true });
  }

  /** Called by the judge worker with the evaluator's per-test results. */
  async applyJudgeResult(payload: EvaluationJobPayload): Promise<void> {
    const ids = parseSubmissionId(payload.submissionId);
    if (!ids) return;
    const attempt = await this.deps.store.attempts.findById(ids.attemptId);
    const current = attempt?.answers[ids.questionId]?.judge;
    if (!attempt || !current || current.submissionId !== payload.submissionId) return;

    const exam = await this.deps.store.exams.findById(attempt.examId);
    const question = exam?.questions.find((q) => q.id === ids.questionId);
    const sampleCount = question?.type === "coding" ? question.sampleTestCases.length : 0;

    const results = payload.response;
    const judgeFailed = results.some((r) => r.status === "ERROR");
    const judge: JudgeRecord = {
      ...current,
      // A judge-side failure isn't the student's fault: marked so it's re-run on submit.
      status: judgeFailed ? "error" : "done",
      passed: results.filter((r) => r.status === "SUCCESS").length,
      // A compile error comes back as one result, so keep the full test count.
      total: current.total,
      judgedAt: new Date(),
    };
    const message = judgeMessage(results, sampleCount);
    if (message) judge.message = message;
    if (!(await this.deps.store.attempts.setJudge(attempt.id, ids.questionId, judge))) return;

    // Late result for an already-submitted attempt: update its score.
    if (attempt.status !== "in_progress" && exam) {
      const fresh = await this.deps.store.attempts.findById(attempt.id);
      if (fresh) {
        const { scores, score } = this.score(exam, fresh.answers);
        await this.deps.store.attempts.setScores(fresh.id, scores, score);
      }
    }
  }

  /** Auto-submits attempts whose time ran out (students who closed the tab). */
  async sweepExpired(now = new Date()): Promise<number> {
    const expired = await this.deps.store.attempts.listExpiredInProgress(
      new Date(now.getTime() - SAVE_GRACE_MS),
    );
    let count = 0;
    for (const attempt of expired) {
      const exam = await this.deps.store.exams.findById(attempt.examId);
      if (exam && (await this.finalize(exam, attempt, "auto_submitted"))) count++;
    }
    return count;
  }

  /* ── internals ── */

  private async load(caller: Caller, attemptId: string) {
    const attempt = await this.deps.store.attempts.findById(attemptId);
    if (!attempt || attempt.userId !== caller.userId) throw new NotFoundError("Attempt", attemptId);
    const exam = await this.deps.store.exams.findById(attempt.examId);
    if (!exam) throw new NotFoundError("Attempt", attemptId);
    return { exam, attempt };
  }

  private assertOpen(attempt: AttemptRecord) {
    if (attempt.status !== "in_progress" || Date.now() > attempt.deadline.getTime() + SAVE_GRACE_MS) {
      throw new ConflictError("Time is up. Your answers were submitted.");
    }
  }

  private async finalizeIfExpired(exam: ExamRecord, attempt: AttemptRecord): Promise<AttemptRecord> {
    if (attempt.status === "in_progress" && Date.now() > attempt.deadline.getTime() + SAVE_GRACE_MS) {
      await this.finalize(exam, attempt, "auto_submitted");
      return (await this.deps.store.attempts.findById(attempt.id)) ?? attempt;
    }
    return attempt;
  }

  /**
   * Final grading. Coding answers whose latest code was never judged are sent
   * to the judge now; their score fills in when the result arrives.
   */
  private async finalize(
    exam: ExamRecord,
    attempt: AttemptRecord,
    status: "submitted" | "auto_submitted",
  ): Promise<boolean> {
    const answers = structuredClone(attempt.answers);
    const toJudge: { question: CodingQuestion; answer: AnswerRecord }[] = [];
    for (const question of exam.questions) {
      const answer = answers[question.id];
      if (question.type !== "coding" || !answer?.code?.trim()) continue;
      const hash = codeHash(answer.language, answer.code);
      if (!answer.judge || answer.judge.codeHash !== hash || answer.judge.status === "error") {
        answer.judge = this.newJudge(attempt.id, question, answer);
        toJudge.push({ question, answer });
      }
    }

    const { scores, score } = this.score(exam, answers);
    const done = await this.deps.store.attempts.finalize(attempt.id, {
      status,
      submittedAt: new Date(),
      scores,
      score,
      answers,
    });
    if (done) {
      for (const { question, answer } of toJudge) {
        await this.deps.judge.submit({
          submissionId: answer.judge!.submissionId,
          userId: attempt.userId,
          code: this.fullCode(question, answer),
          language: answer.language!,
          testCases: allTests(question),
        });
      }
    }
    return done;
  }

  private score(exam: ExamRecord, answers: Record<string, AnswerRecord>) {
    const scores: Record<string, number | null> = {};
    let total = 0;
    let pending = false;
    for (const q of exam.questions) {
      const s = scoreQuestion(q, answers[q.id]);
      scores[q.id] = s;
      if (s === null) pending = true;
      else total += s;
    }
    return { scores, score: pending ? null : round2(total) };
  }

  private newJudge(
    attemptId: string,
    question: CodingQuestion,
    answer: AnswerRecord,
  ): JudgeRecord {
    return {
      submissionId: makeSubmissionId(attemptId, question.id),
      status: "pending",
      passed: 0,
      total: allTests(question).length,
      codeHash: codeHash(answer.language, answer.code),
      requestedAt: new Date(),
    };
  }

  private async requestJudge(
    exam: ExamRecord,
    attempt: AttemptRecord,
    question: CodingQuestion,
    answer: AnswerRecord,
  ) {
    const judge = this.newJudge(attempt.id, question, answer);
    const ok = await this.deps.store.attempts.saveAnswer(
      attempt.id,
      question.id,
      { judge },
      new Date(Date.now() - SAVE_GRACE_MS),
    );
    if (!ok) throw new ConflictError("Time is up. Your answers were submitted.");
    await this.deps.judge.submit({
      submissionId: judge.submissionId,
      userId: attempt.userId,
      code: this.fullCode(question, answer),
      language: answer.language!,
      testCases: allTests(question),
    });
  }

  /** Hidden code before + student's code + hidden driver after. */
  private fullCode(question: CodingQuestion, answer: AnswerRecord): string {
    const stub = question.codeStubs.find((s) => s.language === answer.language);
    return [stub?.startSnippet ?? "", answer.code ?? "", stub?.endSnippet ?? ""].join("\n\n");
  }

  private view(exam: ExamRecord, attempt: AttemptRecord): AttemptView {
    const byId = new Map(exam.questions.map((q) => [q.id, q]));
    const questions: StudentQuestion[] = attempt.questionOrder
      .map((id) => byId.get(id))
      .filter((q): q is ExamQuestion => Boolean(q))
      .map((q) => {
        const base = { id: q.id, type: q.type, prompt: q.prompt, marks: q.marks };
        if (q.type === "coding") {
          return {
            ...base,
            languages: q.languages,
            starterCode: Object.fromEntries(q.codeStubs.map((s) => [s.language, s.userSnippet ?? ""])),
            sampleTestCases: q.sampleTestCases,
          };
        }
        const options = new Map(q.options.map((o) => [o.id, o]));
        const order = attempt.optionOrder[q.id] ?? q.options.map((o) => o.id);
        return { ...base, options: order.map((id) => options.get(id)).filter((o) => o !== undefined) };
      });

    return {
      id: attempt.id,
      examId: exam.id,
      status: attempt.status,
      startedAt: attempt.startedAt.toISOString(),
      deadline: attempt.deadline.toISOString(),
      submittedAt: attempt.submittedAt ? attempt.submittedAt.toISOString() : null,
      serverNow: new Date().toISOString(),
      exam: {
        title: exam.title,
        instructions: exam.instructions,
        durationMinutes: exam.durationMinutes,
        settings: {
          requireFullscreen: exam.settings.requireFullscreen,
          blockCopyPaste: exam.settings.blockCopyPaste,
        },
      },
      questions,
      answers: Object.fromEntries(
        Object.entries(attempt.answers).map(([id, a]) => [id, toAnswerView(a)]),
      ),
      proctorEventCount: attempt.proctorEvents.length,
    };
  }
}
