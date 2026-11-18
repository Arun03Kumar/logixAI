import { createHash, randomInt } from "node:crypto";
import type {
  CodingQuestion,
  ExamPhase,
  ExamQuestion,
  InstitutionRole,
} from "@logixai/contracts";
import type { AnswerRecord, ExamRecord } from "../store/types.js";

/** Seconds after the deadline during which in-flight saves are still accepted. */
export const SAVE_GRACE_MS = 15_000;

export const STAFF_ROLES: InstitutionRole[] = ["owner", "admin", "instructor"];
export const isStaff = (role: InstitutionRole) => STAFF_ROLES.includes(role);

export const round2 = (n: number) => Math.round(n * 100) / 100;

export function totalMarks(questions: ExamQuestion[]): number {
  return round2(questions.reduce((sum, q) => sum + q.marks, 0));
}

export function examPhase(exam: Pick<ExamRecord, "status" | "startsAt" | "endsAt">, now = new Date()): ExamPhase {
  if (exam.status === "draft" || !exam.startsAt || !exam.endsAt) return "draft";
  if (now < exam.startsAt) return "upcoming";
  if (now >= exam.endsAt) return "ended";
  return "live";
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

export function codeHash(language: string | undefined, code: string | undefined): string {
  return createHash("sha256").update(`${language ?? ""}\n${code ?? ""}`).digest("hex");
}

/** All test cases a coding answer is scored against. */
export const allTests = (q: CodingQuestion) => [...q.sampleTestCases, ...q.hiddenTestCases];

/**
 * Score for one question. null = a coding answer that hasn't been judged
 * yet (or whose latest code hasn't been judged).
 */
export function scoreQuestion(question: ExamQuestion, answer: AnswerRecord | undefined): number | null {
  if (question.type === "mcq_single" || question.type === "mcq_multi") {
    const chosen = [...new Set(answer?.selectedOptionIds ?? [])].sort();
    const correct = [...new Set(question.correctOptionIds)].sort();
    const exact = chosen.length === correct.length && chosen.every((id, i) => id === correct[i]);
    return exact ? question.marks : 0;
  }
  if (!answer?.code?.trim()) return 0;
  const judge = answer.judge;
  if (!judge || judge.codeHash !== codeHash(answer.language, answer.code)) return null;
  if (judge.status === "pending") return null;
  if (judge.status === "error" || judge.total === 0) return 0;
  return round2((question.marks * judge.passed) / judge.total);
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

  exam.questions.forEach((q, index) => {
    const label = `Question ${index + 1}`;
    if (!q.prompt.trim()) problems.push(`${label}: write the question.`);
    if (q.marks <= 0) problems.push(`${label}: give it more than 0 marks.`);
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
    } else {
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
    }
  });
  const ids = new Set(exam.questions.map((q) => q.id));
  if (ids.size !== exam.questions.length) problems.push("Question ids must be unique.");
  return problems;
}
