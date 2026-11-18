import type { AnswerView, AttemptResult, JudgeState } from "@logixai/contracts";
import type { AnswerRecord, AttemptRecord, ExamRecord, JudgeRecord } from "../store/types.js";

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
    ...(answer.judge ? { judge: toJudgeState(answer.judge) } : {}),
    savedAt: answer.savedAt.toISOString(),
  };
}

/** Per-question breakdown of a finished attempt. */
export function buildResult(
  exam: ExamRecord,
  attempt: AttemptRecord,
  { includeAnswers }: { includeAnswers: boolean },
): AttemptResult {
  const byId = new Map(exam.questions.map((q) => [q.id, q]));
  const order = attempt.questionOrder.filter((id) => byId.has(id));
  return {
    attemptId: attempt.id,
    examId: exam.id,
    examTitle: exam.title,
    status: attempt.status,
    submittedAt: attempt.submittedAt ? attempt.submittedAt.toISOString() : null,
    released: true,
    score: attempt.score,
    maxScore: attempt.maxScore,
    questions: order.map((id) => {
      const q = byId.get(id)!;
      const answer = attempt.answers[id];
      return {
        questionId: q.id,
        type: q.type,
        prompt: q.prompt,
        marks: q.marks,
        score: attempt.scores?.[q.id] ?? null,
        ...(includeAnswers && q.type !== "coding"
          ? { options: q.options, correctOptionIds: q.correctOptionIds }
          : {}),
        ...(includeAnswers && answer ? { answer: toAnswerView(answer) } : {}),
      };
    }),
  };
}
