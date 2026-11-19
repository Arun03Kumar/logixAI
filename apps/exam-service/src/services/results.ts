import {
  isWrittenType,
  type AnswerView,
  type AttemptResult,
  type GradeView,
  type JudgeState,
  type QuestionResult,
  type ReevaluationView,
} from "@logixai/contracts";
import type {
  AnswerRecord,
  AttemptRecord,
  ExamRecord,
  GradeRecord,
  JudgeRecord,
  ReevaluationRecord,
} from "../store/types.js";
import { isMcqQuestion, isWrittenQuestion } from "../lib/rules.js";

export function toJudgeState(judge: JudgeRecord): JudgeState {
  return {
    status: judge.status,
    passed: judge.passed,
    total: judge.total,
    ...(judge.message ? { message: judge.message } : {}),
    ...(judge.judgedAt ? { judgedAt: judge.judgedAt.toISOString() } : {}),
  };
}

export function toAnswerView(answer: AnswerRecord): AnswerView {
  return {
    ...(answer.selectedOptionIds ? { selectedOptionIds: answer.selectedOptionIds } : {}),
    ...(answer.code !== undefined ? { code: answer.code } : {}),
    ...(answer.language ? { language: answer.language } : {}),
    ...(answer.text !== undefined ? { text: answer.text } : {}),
    ...(answer.judge ? { judge: toJudgeState(answer.judge) } : {}),
    savedAt: answer.savedAt.toISOString(),
  };
}

export function toGradeView(grade: GradeRecord, { staff }: { staff: boolean }): GradeView {
  return {
    marks: grade.marks,
    rubricIds: grade.rubricIds,
    comment: grade.comment,
    gradedAt: grade.gradedAt.toISOString(),
    ...(staff ? { gradedBy: grade.gradedBy } : {}),
  };
}

export function toReevaluationView(r: ReevaluationRecord): ReevaluationView {
  return {
    id: r.id,
    questionId: r.questionId,
    status: r.status,
    reason: r.reason,
    response: r.response,
    requestedAt: r.createdAt.toISOString(),
    resolvedAt: r.resolvedAt ? r.resolvedAt.toISOString() : null,
    scoreBefore: r.scoreBefore,
    scoreAfter: r.scoreAfter,
  };
}

/** Per-question breakdown of a finished attempt. */
export function buildResult(
  exam: ExamRecord,
  attempt: AttemptRecord,
  {
    includeAnswers,
    staff = false,
    reevaluations = [],
  }: { includeAnswers: boolean; staff?: boolean; reevaluations?: ReevaluationRecord[] },
): AttemptResult {
  const byId = new Map(exam.questions.map((q) => [q.id, q]));
  const order = attempt.questionOrder.filter((id) => byId.has(id));
  const grades = attempt.grades ?? {};
  const requests = new Map(reevaluations.map((r) => [r.questionId, r]));
  return {
    attemptId: attempt.id,
    examId: exam.id,
    examTitle: exam.title,
    status: attempt.status,
    submittedAt: attempt.submittedAt ? attempt.submittedAt.toISOString() : null,
    released: true,
    score: attempt.score,
    maxScore: attempt.maxScore,
    sections: exam.sections ?? [],
    questions: order.map((id): QuestionResult => {
      const q = byId.get(id)!;
      const answer = attempt.answers[id];
      const grade = grades[id];
      const score = attempt.scores?.[q.id] ?? null;
      const request = requests.get(id);
      return {
        questionId: q.id,
        type: q.type,
        prompt: q.prompt,
        marks: q.marks,
        sectionId: q.sectionId ?? null,
        score,
        ...(includeAnswers && isMcqQuestion(q)
          ? { options: q.options, correctOptionIds: q.correctOptionIds, negativeMarks: q.negativeMarks ?? 0 }
          : {}),
        ...(includeAnswers && isWrittenQuestion(q) ? { rubric: q.rubric, modelAnswer: q.modelAnswer } : {}),
        ...(includeAnswers && answer ? { answer: toAnswerView(answer) } : {}),
        ...(includeAnswers && grade ? { grade: toGradeView(grade, { staff }) } : {}),
        ...(isWrittenType(q.type) && !grade && score === null && attempt.status !== "in_progress"
          ? { awaitingGrading: true }
          : {}),
        ...(request ? { reevaluation: toReevaluationView(request) } : {}),
      };
    }),
    reevaluation: { open: false, until: null },
  };
}
