import { z } from "zod";
import { LanguageIdSchema, TestCaseSchema } from "./common";
import { CodeStubSchema } from "./problem";
import type { LanguageId } from "@logixai/languages";

/* ─── Questions ─────────────────────────────────────────────────────────
 * Drafts are lenient so instructors can save half-written questions;
 * publishing runs the strict checks (see exam-service validateExam).
 */

export const QUESTION_TYPES = ["mcq_single", "mcq_multi", "coding"] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

/** Client-generated ids. Restricted because they become storage keys. */
const id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, "Invalid id");

export const OptionSchema = z.object({
  id,
  text: z.string().max(2000),
});
export type QuestionOption = z.infer<typeof OptionSchema>;

const questionBase = {
  id,
  prompt: z.string().max(20000).default(""),
  marks: z.number().min(0).max(1000).default(1),
};

export const McqQuestionSchema = z.object({
  ...questionBase,
  type: z.enum(["mcq_single", "mcq_multi"]),
  options: z.array(OptionSchema).max(10).default([]),
  correctOptionIds: z.array(id).max(10).default([]),
});

export const CodingQuestionSchema = z.object({
  ...questionBase,
  type: z.literal("coding"),
  languages: z.array(LanguageIdSchema).max(10).default([]),
  codeStubs: z.array(CodeStubSchema).max(10).default([]),
  /** Shown to students. */
  sampleTestCases: z.array(TestCaseSchema).max(5).default([]),
  /** Never sent to students. Scoring uses samples + these. */
  hiddenTestCases: z.array(TestCaseSchema).max(50).default([]),
});

export const QuestionSchema = z.discriminatedUnion("type", [
  McqQuestionSchema,
  CodingQuestionSchema,
]);
export type ExamQuestion = z.infer<typeof QuestionSchema>;
export type McqQuestion = z.infer<typeof McqQuestionSchema>;
export type CodingQuestion = z.infer<typeof CodingQuestionSchema>;

/* ─── Exams ─────────────────────────────────────────────────────────── */

export const RESULTS_VISIBILITY = ["after_submit", "after_end", "hidden"] as const;

export const ExamSettingsSchema = z.object({
  shuffleQuestions: z.boolean().default(false),
  shuffleOptions: z.boolean().default(false),
  requireFullscreen: z.boolean().default(true),
  blockCopyPaste: z.boolean().default(true),
  resultsVisibility: z.enum(RESULTS_VISIBILITY).default("after_end"),
});
export type ExamSettings = z.infer<typeof ExamSettingsSchema>;

const isoDate = z.iso.datetime({ offset: true });

/** Full draft, as saved by the exam builder (PUT replaces it). */
export const ExamDraftSchema = z.object({
  title: z.string().trim().min(1, "Give the exam a title").max(200),
  instructions: z.string().max(20000).default(""),
  durationMinutes: z.number().int().min(1).max(600).default(60),
  startsAt: isoDate.nullable().default(null),
  endsAt: isoDate.nullable().default(null),
  /** Empty = every student in the institution. */
  batchIds: z.array(id).max(100).default([]),
  settings: ExamSettingsSchema.default({
    shuffleQuestions: false,
    shuffleOptions: false,
    requireFullscreen: true,
    blockCopyPaste: true,
    resultsVisibility: "after_end",
  }),
  questions: z.array(QuestionSchema).max(200).default([]),
});
export type ExamDraftInput = z.infer<typeof ExamDraftSchema>;

export const CreateExamSchema = z.object({
  title: z.string().trim().min(1, "Give the exam a title").max(200),
});

export const EXAM_STATUSES = ["draft", "published"] as const;
export type ExamStatus = (typeof EXAM_STATUSES)[number];

/** Where an exam is in time, from the student's point of view. */
export type ExamPhase = "draft" | "upcoming" | "live" | "ended";

/* ─── Attempts ──────────────────────────────────────────────────────── */

export const ATTEMPT_STATUSES = ["in_progress", "submitted", "auto_submitted"] as const;
export type AttemptStatus = (typeof ATTEMPT_STATUSES)[number];

export const SaveAnswerSchema = z.object({
  selectedOptionIds: z.array(id).max(10).optional(),
  code: z.string().max(100_000).optional(),
  language: LanguageIdSchema.optional(),
});
export type SaveAnswerInput = z.infer<typeof SaveAnswerSchema>;

export const PROCTOR_EVENTS = [
  "tab_hidden",
  "window_blur",
  "fullscreen_exit",
  "copy",
  "paste",
] as const;
export const ProctorEventSchema = z.object({ type: z.enum(PROCTOR_EVENTS) });
export type ProctorEventType = (typeof PROCTOR_EVENTS)[number];

/* ─── Views ─────────────────────────────────────────────────────────── */

export interface ExamSummary {
  id: string;
  institutionId: string;
  title: string;
  instructions: string;
  status: ExamStatus;
  phase: ExamPhase;
  durationMinutes: number;
  startsAt: string | null;
  endsAt: string | null;
  batchIds: string[];
  questionCount: number;
  totalMarks: number;
  proctoring: Pick<ExamSettings, "requireFullscreen" | "blockCopyPaste">;
  createdAt: string;
  /** Present for students who have started. */
  myAttempt?: { id: string; status: AttemptStatus; score: number | null; maxScore: number };
}

/** Full exam for instructors (includes answers and hidden tests). */
export interface ExamDetail extends ExamSummary, Omit<ExamDraftInput, "questions"> {
  questions: ExamQuestion[];
  attemptCount: number;
}

export interface JudgeState {
  status: "pending" | "done" | "error";
  passed: number;
  total: number;
  /** First failing run's output (compile/runtime error), samples only. */
  message?: string;
  judgedAt?: string;
}

export interface StudentQuestion {
  id: string;
  type: QuestionType;
  prompt: string;
  marks: number;
  options?: QuestionOption[];
  languages?: LanguageId[];
  starterCode?: Partial<Record<LanguageId, string>>;
  sampleTestCases?: { input: string; output: string }[];
}

export interface AnswerView {
  selectedOptionIds?: string[];
  code?: string;
  language?: LanguageId;
  judge?: JudgeState;
  savedAt: string;
}

export interface AttemptView {
  id: string;
  examId: string;
  status: AttemptStatus;
  startedAt: string;
  deadline: string;
  submittedAt: string | null;
  /** Server clock, so the client timer isn't fooled by a wrong device clock. */
  serverNow: string;
  exam: {
    title: string;
    instructions: string;
    durationMinutes: number;
    settings: Pick<ExamSettings, "requireFullscreen" | "blockCopyPaste">;
  };
  questions: StudentQuestion[];
  answers: Record<string, AnswerView>;
  proctorEventCount: number;
}

export interface QuestionResult {
  questionId: string;
  type: QuestionType;
  prompt: string;
  marks: number;
  score: number | null;
  /** MCQ only, when results include answers. */
  options?: QuestionOption[];
  correctOptionIds?: string[];
  answer?: AnswerView;
}

export interface AttemptResult {
  attemptId: string;
  examId: string;
  examTitle: string;
  status: AttemptStatus;
  submittedAt: string | null;
  /** false when the exam's settings keep scores hidden for now. */
  released: boolean;
  /** null while coding answers are still being judged, or when not released. */
  score: number | null;
  maxScore: number;
  questions: QuestionResult[];
}

export interface ResultRow {
  attemptId: string;
  userId: string;
  name: string;
  email: string;
  status: AttemptStatus;
  startedAt: string;
  submittedAt: string | null;
  score: number | null;
  maxScore: number;
  proctorEventCount: number;
}

export interface AttemptReview extends AttemptResult {
  student: { userId: string; name: string; email: string };
  startedAt: string;
  proctorEvents: { type: ProctorEventType; at: string }[];
}
