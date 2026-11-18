import { z } from "zod";
import { LanguageIdSchema, TestCaseSchema } from "./common";
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

/** BullMQ job names. */
export const JOB_NAMES = {
  SUBMISSION: "SubmissionJob",
  EVALUATION: "EvaluationJob",
} as const;

/**
 * How the evaluator compares a test's stdout with the expected output.
 *  - lines: exact text, ignoring trailing spaces and blank lines at the end.
 *  - json:  both sides are JSON; numbers match within absTol + relTol * |expected|.
 *           Used by ML Arena, whose harness prints the function's return value as JSON.
 */
export const CheckerSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("lines") }),
  z.object({
    kind: z.literal("json"),
    absTol: z.number().nonnegative().default(1e-6),
    relTol: z.number().nonnegative().default(1e-6),
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
