import { z } from "zod";
import { LanguageIdSchema, TestCaseSchema } from "./common";
import { CodeStubSchema, DIFFICULTIES, type Difficulty } from "./problem";
import type { LanguageId } from "@logixai/languages";

/* ─── Questions ─────────────────────────────────────────────────────────
 * Drafts are lenient so instructors can save half-written questions;
 * publishing runs the strict checks (see exam-service validateExam).
 */

export const QUESTION_TYPES = ["mcq_single", "mcq_multi", "coding", "short_answer", "long_answer"] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];
/** Answers a person grades (needs the institution's `subjective` feature). */
export const WRITTEN_TYPES = ["short_answer", "long_answer"] as const;
export const isWrittenType = (t: QuestionType): t is (typeof WRITTEN_TYPES)[number] =>
  (WRITTEN_TYPES as readonly string[]).includes(t);

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
  /** The exam section it belongs to (none = before the first section). */
  sectionId: id.nullable().optional(),
};

export const McqQuestionSchema = z.object({
  ...questionBase,
  type: z.enum(["mcq_single", "mcq_multi"]),
  options: z.array(OptionSchema).max(10).default([]),
  correctOptionIds: z.array(id).max(10).default([]),
  /** Taken off for a wrong (not a blank) answer. 0 = no negative marking. */
  negativeMarks: z.number().min(0).max(1000).default(0),
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

export const RubricItemSchema = z.object({
  id,
  label: z.string().max(500),
  marks: z.number().min(0).max(1000),
});
export type RubricItem = z.infer<typeof RubricItemSchema>;

/** Short (a line or two) and long (an essay) written answers, graded by staff. */
export const WrittenQuestionSchema = z.object({
  ...questionBase,
  type: z.enum(WRITTEN_TYPES),
  /** Shown to graders, and to students once results are out. */
  modelAnswer: z.string().max(20000).default(""),
  /** Points graders tick; they add up to the marks given (graders can adjust). */
  rubric: z.array(RubricItemSchema).max(20).default([]),
  /** Word limit shown to the student (not enforced). */
  maxWords: z.number().int().min(1).max(10000).nullable().default(null),
});

export const QuestionSchema = z.discriminatedUnion("type", [
  McqQuestionSchema,
  CodingQuestionSchema,
  WrittenQuestionSchema,
]);
export type ExamQuestion = z.infer<typeof QuestionSchema>;
export type McqQuestion = z.infer<typeof McqQuestionSchema>;
export type CodingQuestion = z.infer<typeof CodingQuestionSchema>;
export type WrittenQuestion = z.infer<typeof WrittenQuestionSchema>;

export const ExamSectionSchema = z.object({
  id,
  title: z.string().max(200),
  instructions: z.string().max(5000).default(""),
});
export type ExamSection = z.infer<typeof ExamSectionSchema>;

/* ─── Exams ─────────────────────────────────────────────────────────── */

export const RESULTS_VISIBILITY = ["after_submit", "after_end", "hidden"] as const;

export const ExamSettingsSchema = z.object({
  shuffleQuestions: z.boolean().default(false),
  shuffleOptions: z.boolean().default(false),
  requireFullscreen: z.boolean().default(true),
  blockCopyPaste: z.boolean().default(true),
  resultsVisibility: z.enum(RESULTS_VISIBILITY).default("after_end"),
  /** Students see their rank and percentile with their result. */
  showRank: z.boolean().default(false),
  /** Days after the exam closes that students may ask for a re-check. 0 = off. */
  reevaluationDays: z.number().int().min(0).max(60).default(0),
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
    showRank: false,
    reevaluationDays: 0,
  }),
  sections: z.array(ExamSectionSchema).max(20).default([]),
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
  text: z.string().max(50_000).optional(),
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

/* ─── Grading, extra time, re-evaluation ───────────────────────────── */

/** PUT /exams/:id/attempts/:attemptId/grades/:questionId. marks null = back to the automatic score. */
export const GradeAnswerSchema = z.object({
  marks: z.number().min(0).max(1000).nullable(),
  rubricIds: z.array(id).max(20).default([]),
  comment: z.string().trim().max(5000).default(""),
});
export type GradeAnswerInput = z.infer<typeof GradeAnswerSchema>;

export const GradingQuerySchema = z.object({
  /** "ungraded" (default) or "all". */
  show: z.enum(["ungraded", "all"]).default("ungraded"),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).max(500).optional(),
});

/** PUT /exams/:id/extra-time: minutes on top of the duration (and the closing time). 0 removes it. */
export const ExtraTimeSchema = z.object({
  userId: id,
  minutes: z.number().int().min(0).max(600),
});

export const RequestReevaluationSchema = z.object({
  questionId: id,
  reason: z.string().trim().min(5, "Say what you'd like re-checked").max(2000),
});

export const ResolveReevaluationSchema = z.object({
  response: z.string().trim().min(1, "Write a reply to the student").max(2000),
  /** New marks for the question; leave out to keep the current score. */
  marks: z.number().min(0).max(1000).optional(),
});

export const REEVALUATION_STATUSES = ["open", "resolved"] as const;
export type ReevaluationStatus = (typeof REEVALUATION_STATUSES)[number];

/* ─── Question bank ─────────────────────────────────────────────────── */

const tag = z.string().trim().toLowerCase().min(1).max(40);

export const BankQuestionInputSchema = z.object({
  question: QuestionSchema,
  topic: z.string().trim().max(100).default(""),
  tags: z.array(tag).max(20).default([]),
  difficulty: z.enum(DIFFICULTIES).nullable().default(null),
});
export type BankQuestionInput = z.infer<typeof BankQuestionInputSchema>;

export const BankQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  tag: tag.optional(),
  type: z.enum(QUESTION_TYPES).optional(),
  difficulty: z.enum(DIFFICULTIES).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).max(500).optional(),
});
export type BankQuery = z.infer<typeof BankQuerySchema>;

export interface BankQuestionView {
  id: string;
  institutionId: string;
  question: ExamQuestion;
  topic: string;
  tags: string[];
  difficulty: Difficulty | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

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
  /** Has short or long answers that staff grade. */
  hasWritten: boolean;
  createdAt: string;
  /** Present for students who have started. */
  myAttempt?: { id: string; status: AttemptStatus; score: number | null; maxScore: number };
}

/** Full exam for instructors (includes answers and hidden tests). */
export interface ExamDetail extends ExamSummary, Omit<ExamDraftInput, "questions"> {
  questions: ExamQuestion[];
  attemptCount: number;
  /** Extra minutes per student (userId → minutes). Can change after publishing. */
  extraTime: Record<string, number>;
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
  sectionId?: string | null;
  /** MCQ: marks lost for a wrong answer. */
  negativeMarks?: number;
  options?: QuestionOption[];
  languages?: LanguageId[];
  starterCode?: Partial<Record<LanguageId, string>>;
  sampleTestCases?: { input: string; output: string }[];
  /** Written answers: word limit, if any. */
  maxWords?: number | null;
}

export interface AnswerView {
  selectedOptionIds?: string[];
  code?: string;
  language?: LanguageId;
  text?: string;
  judge?: JudgeState;
  savedAt: string;
}

export interface GradeView {
  marks: number;
  rubricIds: string[];
  comment: string;
  gradedAt: string;
  /** Staff views only. */
  gradedBy?: string;
}

export interface ReevaluationView {
  id: string;
  questionId: string;
  status: ReevaluationStatus;
  reason: string;
  response: string;
  requestedAt: string;
  resolvedAt: string | null;
  /** Question score when asked, and after it was resolved. */
  scoreBefore: number | null;
  scoreAfter: number | null;
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
    sections: ExamSection[];
  };
  /** Extra minutes this student was given (already in the deadline). */
  extraMinutes: number;
  questions: StudentQuestion[];
  answers: Record<string, AnswerView>;
  proctorEventCount: number;
}

export interface QuestionResult {
  questionId: string;
  type: QuestionType;
  prompt: string;
  marks: number;
  sectionId?: string | null;
  score: number | null;
  /** MCQ only, when results include answers. */
  options?: QuestionOption[];
  correctOptionIds?: string[];
  negativeMarks?: number;
  /** Written answers, when results include answers. */
  rubric?: RubricItem[];
  modelAnswer?: string;
  answer?: AnswerView;
  /** Set when a grader marked or overrode this answer. */
  grade?: GradeView;
  /** Written answer that hasn't been graded yet. */
  awaitingGrading?: boolean;
  reevaluation?: ReevaluationView;
}

export interface RankView {
  /** 1 = top. Equal scores share a rank. */
  position: number;
  outOf: number;
  /** Share of other scored students below this one, 0–100. */
  percentile: number;
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
  sections: ExamSection[];
  questions: QuestionResult[];
  /** With the exam's showRank setting, once released and scored. */
  rank?: RankView;
  /** Whether the student may still ask for a re-check, and until when. */
  reevaluation: { open: boolean; until: string | null };
}

export interface ResultRow {
  attemptId: string;
  userId: string;
  name: string;
  email: string;
  /** The student's roll number in the institution, if they have one. */
  rollNumber: string | null;
  status: AttemptStatus;
  startedAt: string;
  submittedAt: string | null;
  score: number | null;
  maxScore: number;
  proctorEventCount: number;
}

/** Whole-exam numbers, computed by the database (not from the current page). */
export interface ResultSummary {
  attempts: number;
  submitted: number;
  inProgress: number;
  /** Attempts with at least one proctoring event. */
  flagged: number;
  averageScore: number | null;
  highestScore: number | null;
  lowestScore: number | null;
  /** Submitted attempts without a final score (written answers to grade, or code being judged). */
  awaitingScore: number;
  /** Re-evaluation requests waiting for staff. */
  openReevaluations: number;
}

/** GET /exams/:id/results: best scores first, `limit` rows per page. */
export interface ExamResultsPage {
  exam: ExamSummary;
  summary: ResultSummary;
  items: ResultRow[];
  nextCursor: string | null;
}

export interface AttemptReview extends AttemptResult {
  student: { userId: string; name: string; email: string; rollNumber: string | null };
  startedAt: string;
  extraMinutes: number;
  proctorEvents: { type: ProctorEventType; at: string }[];
}

/** GET /exams/:id/grading: written questions and how much is left to grade. */
export interface GradingOverview {
  exam: ExamSummary;
  sections: ExamSection[];
  questions: {
    questionId: string;
    type: QuestionType;
    prompt: string;
    marks: number;
    sectionId: string | null;
    /** Submitted non-blank answers. */
    answered: number;
    graded: number;
  }[];
  openReevaluations: number;
}

/** One answer in the grading queue. */
export interface GradingItem {
  attemptId: string;
  userId: string;
  name: string;
  rollNumber: string | null;
  answer: AnswerView;
  grade: GradeView | null;
  reevaluation?: ReevaluationView;
}

export interface GradingPage {
  question: WrittenQuestion;
  items: GradingItem[];
  nextCursor: string | null;
}

/** Answer to a grade change: the question's and the attempt's new scores. */
export interface GradeResult {
  attemptId: string;
  questionId: string;
  questionScore: number | null;
  /** null while other answers still wait for grading or judging. */
  score: number | null;
  grade: GradeView | null;
}

export interface ReevaluationRow extends ReevaluationView {
  attemptId: string;
  userId: string;
  name: string;
  rollNumber: string | null;
  questionPrompt: string;
  questionMarks: number;
  /** The question's current score. */
  currentScore: number | null;
}
