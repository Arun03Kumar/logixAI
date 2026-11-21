import { z } from "zod";
import { LanguageIdSchema, TestCaseSchema } from "./common";
import type { LanguageId } from "@logixai/languages";
import { METRICS } from "./checker";
import { ExecutionResponseSchema } from "./submission";

/** BullMQ queue names shared by producers and workers. */
export const QUEUE_NAMES = {
  SUBMISSION: "SubmissionQueue",
  /** Default reply queue: practice submissions (submission-service). */
  EVALUATION: "EvaluationQueue",
  /** Reply queue for exam answers (exam-service). */
  EXAM_EVALUATION: "ExamEvaluationQueue",
  /** Reply queue for ML Arena code items (arena-service). */
  ARENA_EVALUATION: "ArenaEvaluationQueue",
} as const;

/**
 * Judge queues, one per group of sandbox images, so a burst of slow PyTorch
 * runs can't hold up DSA or exam code. Evaluators choose which groups they
 * serve (JUDGE_QUEUES), so each group can be scaled on its own queue length.
 * DSA keeps the original name, so jobs queued before an upgrade still run.
 */
export const JUDGE_QUEUES = {
  dsa: QUEUE_NAMES.SUBMISSION,
  "python-ml": "SubmissionQueue-python-ml",
  "node-web": "SubmissionQueue-node-web",
} as const;
export type JudgeQueueGroup = keyof typeof JUDGE_QUEUES;
export const JUDGE_QUEUE_GROUPS = Object.keys(JUDGE_QUEUES) as JudgeQueueGroup[];

export function judgeQueueGroup(language: LanguageId): JudgeQueueGroup {
  if (language === "PYTHON_ML") return "python-ml";
  if (language === "NODE_WEB") return "node-web";
  return "dsa";
}

/** The queue a submission in `language` goes to. */
export const judgeQueueFor = (language: LanguageId): string => JUDGE_QUEUES[judgeQueueGroup(language)];

/**
 * BullMQ priorities (lower runs first): an exam answer never waits behind
 * practice, and a Submit (graded) goes before a Run (just checking).
 */
export const JUDGE_PRIORITY = { exam: 1, submit: 3, run: 5 } as const;

/** Options every judge job is added with: priority, and a bounded history in Redis. */
export const judgeJobOptions = (priority: number) => ({ priority, removeOnComplete: 1000, removeOnFail: 1000 });

/** BullMQ job names. */
export const JOB_NAMES = {
  SUBMISSION: "SubmissionJob",
  EVALUATION: "EvaluationJob",
} as const;

/**
 * How the evaluator compares a test's stdout with the expected output.
 *  - lines: exact text, ignoring trailing spaces and blank lines at the end.
 *  - json:   both sides are JSON; numbers match within absTol + relTol * |expected|.
 *            Used by ML Arena, whose harness prints the function's return value as JSON.
 *  - metric: predictions scored against hidden labels (ML Arena dataset challenges).
 */
export const CheckerSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("lines") }),
  z.object({
    kind: z.literal("json"),
    absTol: z.number().nonnegative().default(1e-6),
    relTol: z.number().nonnegative().default(1e-6),
  }),
  /**
   * metric: the program prints predictions as a JSON list; the expected output
   * is the true labels. Passes when the score reaches the threshold (for
   * error metrics like rmse, when it is at most the threshold).
   */
  z.object({
    kind: z.literal("metric"),
    metric: z.enum(METRICS),
    threshold: z.number(),
  }),
]);
export type Checker = z.infer<typeof CheckerSchema>;

/**
 * submission-service -> evaluator-service (SubmissionQueue / SubmissionJob).
 * The payload is keyed by submission id: { [submissionId]: SubmissionJobItem }.
 */
export const SubmissionJobItemSchema = z.object({
  code: z.string(),
  language: LanguageIdSchema,
  inputCase: z.string(),
  outputCase: z.string().optional(),
  userId: z.string(),
  submissionId: z.string(),
  testCases: z.array(TestCaseSchema).default([]),
  /**
   * Queue the evaluator publishes the result to. Lets several services share
   * the judge without consuming each other's results.
   */
  replyQueue: z.string().min(1).default("EvaluationQueue"),
  checker: CheckerSchema.default({ kind: "lines" }),
});
export type SubmissionJobItem = z.infer<typeof SubmissionJobItemSchema>;

export const SubmissionJobPayloadSchema = z.record(
  z.string(),
  SubmissionJobItemSchema,
);
export type SubmissionJobPayload = z.infer<typeof SubmissionJobPayloadSchema>;

/** evaluator-service -> submission-service (EvaluationQueue / EvaluationJob). */
export const EvaluationJobPayloadSchema = z.object({
  response: z.array(ExecutionResponseSchema),
  userId: z.string(),
  submissionId: z.string(),
});
export type EvaluationJobPayload = z.infer<typeof EvaluationJobPayloadSchema>;
