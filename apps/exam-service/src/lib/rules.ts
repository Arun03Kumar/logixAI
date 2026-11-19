import { createHash, randomInt } from "node:crypto";
import {
  isWrittenType,
  type CodingQuestion,
  type ExamPhase,
  type ExamQuestion,
  type InstitutionRole,
  type McqQuestion,
  type WrittenQuestion,
} from "@logixai/contracts";
import type { AnswerRecord, ExamRecord, GradeRecord } from "../store/types.js";

/** Seconds after the deadline during which in-flight saves are still accepted. */
export const SAVE_GRACE_MS = 15_000;

export const STAFF_ROLES: InstitutionRole[] = ["owner", "admin", "instructor"];
export const isStaff = (role: InstitutionRole) => STAFF_ROLES.includes(role);

export const round2 = (n: number) => Math.round(n * 100) / 100;

export function totalMarks(questions: ExamQuestion[]): number {
  return round2(questions.reduce((sum, q) => sum + q.marks, 0));
}

/** Type guards on the whole question (a union discriminant doesn't narrow by itself). */
export const isWrittenQuestion = (q: ExamQuestion): q is WrittenQuestion => isWrittenType(q.type);
export const isMcqQuestion = (q: ExamQuestion): q is McqQuestion => q.type === "mcq_single" || q.type === "mcq_multi";

export const hasWritten = (exam: Pick<ExamRecord, "questions">) => exam.questions.some((q) => isWrittenType(q.type));

export function examPhase(exam: Pick<ExamRecord, "status" | "startsAt" | "endsAt">, now = new Date()): ExamPhase {
  if (exam.status === "draft" || !exam.startsAt || !exam.endsAt) return "draft";
  if (now < exam.startsAt) return "upcoming";
  if (now >= exam.endsAt) return "ended";
  return "live";
}

const MINUTE = 60_000;

/** Extra minutes given to one student. */
export const extraMinutes = (exam: Pick<ExamRecord, "extraTime">, userId: string) => exam.extraTime?.[userId] ?? 0;

/**
 * When an attempt must be in: the duration (plus extra time) from the start,
 * and never after the closing time (which extra time also pushes back).
 */
export function deadlineFor(exam: Pick<ExamRecord, "durationMinutes" | "endsAt">, startedAt: Date, extra: number): Date {
  const byDuration = startedAt.getTime() + (exam.durationMinutes + extra) * MINUTE;
  const byClose = exam.endsAt ? exam.endsAt.getTime() + extra * MINUTE : byDuration;
  return new Date(Math.min(byDuration, byClose));
}

/** The exam is over for everyone, including students with extra time. */
export function finishedAt(exam: Pick<ExamRecord, "endsAt" | "extraTime">): Date | null {
  if (!exam.endsAt) return null;
  const most = Math.max(0, ...Object.values(exam.extraTime ?? {}));
  return new Date(exam.endsAt.getTime() + most * MINUTE);
}

/** A student may take the exam if it targets no batch, or one of theirs. */
export function isAssigned(exam: Pick<ExamRecord, "batchIds">, batchIds: string[]): boolean {
  return exam.batchIds.length === 0 || exam.batchIds.some((b) => batchIds.includes(b));
}

/** Fisher-Yates with a crypto RNG. */
export function shuffle<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/**
 * Question order for one student: questions without a section first, then
 * each section in order. Shuffling stays inside a section.
 */
export function questionOrder(exam: Pick<ExamRecord, "questions" | "sections">, shuffleQuestions: boolean): string[] {
  const sections = exam.sections ?? [];
  const known = new Set(sections.map((s) => s.id));
  const groups: string[][] = [[], ...sections.map(() => [] as string[])];
  for (const q of exam.questions) {
    const index = q.sectionId && known.has(q.sectionId) ? sections.findIndex((s) => s.id === q.sectionId) + 1 : 0;
    groups[index]!.push(q.id);
  }
  return groups.flatMap((ids) => (shuffleQuestions ? shuffle(ids) : ids));
}

export function codeHash(language: string | undefined, code: string | undefined): string {
  return createHash("sha256").update(`${language ?? ""}\n${code ?? ""}`).digest("hex");
}

/** All test cases a coding answer is scored against. */
export const allTests = (q: CodingQuestion) => [...q.sampleTestCases, ...q.hiddenTestCases];

/** A written answer with something in it. */
export const hasText = (answer: AnswerRecord | undefined) => Boolean(answer?.text?.trim());

/**
 * Automatic score for one question. null = waiting: a coding answer that
 * hasn't been judged (or whose latest code hasn't), or a written answer that
 * a person has to grade. Blank answers score 0 straight away.
 */
export function scoreQuestion(question: ExamQuestion, answer: AnswerRecord | undefined): number | null {
  if (isMcqQuestion(question)) {
    const chosen = [...new Set(answer?.selectedOptionIds ?? [])].sort();
    if (chosen.length === 0) return 0;
    const correct = [...new Set(question.correctOptionIds)].sort();
    const exact = chosen.length === correct.length && chosen.every((id, i) => id === correct[i]);
    if (exact) return question.marks;
    return question.negativeMarks ? -question.negativeMarks : 0;
  }
  if (isWrittenQuestion(question)) return hasText(answer) ? null : 0;
  if (!answer?.code?.trim()) return 0;
  const judge = answer.judge;
  if (!judge || judge.codeHash !== codeHash(answer.language, answer.code)) return null;
  if (judge.status === "pending") return null;
  if (judge.status === "error" || judge.total === 0) return 0;
  return round2((question.marks * judge.passed) / judge.total);
}

/**
 * Per-question scores and the total. A grader's marks replace the automatic
 * score. The total is null while any question is still waiting.
 */
export function computeScores(
  exam: Pick<ExamRecord, "questions">,
  answers: Record<string, AnswerRecord>,
  grades: Record<string, GradeRecord> = {},
): { scores: Record<string, number | null>; score: number | null } {
  const scores: Record<string, number | null> = {};
  let total = 0;
  let pending = false;
  for (const q of exam.questions) {
    const grade = grades[q.id];
    const s = grade ? grade.marks : scoreQuestion(q, answers[q.id]);
    scores[q.id] = s;
    if (s === null) pending = true;
    else total += s;
  }
  return { scores, score: pending ? null : round2(total) };
}

/** Problems that must be fixed before an exam can be published. */
export function validateExam(exam: ExamRecord, now = new Date()): string[] {
  const problems: string[] = [];
  if (!exam.startsAt || !exam.endsAt) {
    problems.push("Set when the exam opens and closes.");
  } else {
    if (exam.endsAt <= exam.startsAt) problems.push("The exam must close after it opens.");
    if (exam.endsAt <= now) problems.push("The closing time is already in the past.");
    const windowMinutes = (exam.endsAt.getTime() - exam.startsAt.getTime()) / 60_000;
    if (windowMinutes < exam.durationMinutes) {
      problems.push("The exam window is shorter than the exam's duration.");
    }
  }
  if (exam.questions.length === 0) problems.push("Add at least one question.");

  const sections = exam.sections ?? [];
  const sectionIds = new Set(sections.map((s) => s.id));
  if (sectionIds.size !== sections.length) problems.push("Section ids must be unique.");
  sections.forEach((s, index) => {
    const label = `Section ${index + 1}`;
    if (!s.title.trim()) problems.push(`${label}: give it a title.`);
    if (!exam.questions.some((q) => q.sectionId === s.id)) problems.push(`${label}: add questions or remove it.`);
  });

  exam.questions.forEach((q, index) => {
    const label = `Question ${index + 1}`;
    if (!q.prompt.trim()) problems.push(`${label}: write the question.`);
    if (q.marks <= 0) problems.push(`${label}: give it more than 0 marks.`);
    if (q.sectionId && !sectionIds.has(q.sectionId)) problems.push(`${label}: its section no longer exists.`);
    if (q.type === "coding") {
      if (q.languages.length === 0) problems.push(`${label}: allow at least one language.`);
      if (allTests(q).length === 0) problems.push(`${label}: add at least one test case.`);
      if (allTests(q).some((t) => !t.input.trim() && !t.output.trim())) {
        problems.push(`${label}: fill in or remove empty test cases.`);
      }
      for (const lang of q.languages) {
        if (!q.codeStubs.some((s) => s.language === lang)) {
          problems.push(`${label}: add code stubs for ${lang}.`);
        }
      }
    } else if (isWrittenQuestion(q)) {
      if (q.rubric.some((r) => !r.label.trim())) problems.push(`${label}: fill in or remove empty rubric points.`);
      const rubricTotal = round2(q.rubric.reduce((sum, r) => sum + r.marks, 0));
      if (rubricTotal > q.marks) problems.push(`${label}: the rubric adds up to more than the question's marks.`);
      if (new Set(q.rubric.map((r) => r.id)).size !== q.rubric.length) problems.push(`${label}: rubric ids must be unique.`);
    } else if (isMcqQuestion(q)) {
      const options = q.options.filter((o) => o.text.trim());
      if (options.length < 2) problems.push(`${label}: add at least two options.`);
      if (options.length !== q.options.length) problems.push(`${label}: remove empty options.`);
      const ids = new Set(q.options.map((o) => o.id));
      if (ids.size !== q.options.length) problems.push(`${label}: option ids must be unique.`);
      const correct = q.correctOptionIds.filter((id) => ids.has(id));
      if (correct.length === 0) problems.push(`${label}: mark the correct answer.`);
      if (q.type === "mcq_single" && correct.length > 1) {
        problems.push(`${label}: single-choice questions have exactly one correct answer.`);
      }
      if ((q.negativeMarks ?? 0) > q.marks) problems.push(`${label}: negative marks can't be more than the question's marks.`);
    }
  });
  const ids = new Set(exam.questions.map((q) => q.id));
  if (ids.size !== exam.questions.length) problems.push("Question ids must be unique.");
  return problems;
}
