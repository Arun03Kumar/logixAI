import { z } from "zod";
import { LanguageIdSchema, TestCaseSchema } from "./common";
import { ExecutionResponseSchema } from "./submission";

/** BullMQ queue names shared by producers and workers. */
export const QUEUE_NAMES = {
  SUBMISSION: "SubmissionQueue",
  EVALUATION: "EvaluationQueue",
} as const;

/** BullMQ job names. */
export const JOB_NAMES = {
  SUBMISSION: "SubmissionJob",
  EVALUATION: "EvaluationJob",
} as const;

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
