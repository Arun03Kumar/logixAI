import { z } from "zod";
import { LanguageIdSchema } from "./common";

/** Status stored on a Submission document. */
export const SUBMISSION_STATUSES = [
  "Pending",
  "Success",
  "WA",
  "TLE",
  "MLE",
  "RE",
  "CE",
] as const;
export const SubmissionStatusSchema = z.enum(SUBMISSION_STATUSES);
export type SubmissionStatus = z.infer<typeof SubmissionStatusSchema>;

/**
 * run    = sample tests only, quick feedback while coding
 * submit = sample + hidden tests, the real verdict
 */
export const SUBMISSION_MODES = ["run", "submit"] as const;
export type SubmissionMode = (typeof SUBMISSION_MODES)[number];

/** Body of POST /api/v1/submission */
export const CreateSubmissionSchema = z.object({
  userId: z.string().min(1),
  problemId: z.string().min(1),
  code: z.string().max(100_000),
  language: z
    .string()
    .transform((value) => value.toUpperCase())
    .pipe(LanguageIdSchema),
  mode: z.enum(SUBMISSION_MODES).default("submit"),
});
export type CreateSubmissionInput = z.infer<typeof CreateSubmissionSchema>;

/**
 * Verdict for one test case, produced by the evaluator.
 * SUCCESS  output matched
 * WA       ran fine, wrong output
 * TLE      exceeded the time limit
 * MLE      exceeded the memory limit
 * RE       crashed / non-zero exit
 * CE       didn't compile (reported once, no tests run)
 * ERROR    the judge itself failed (not the student's fault)
 */
export const EXECUTION_STATUSES = ["SUCCESS", "WA", "TLE", "MLE", "RE", "CE", "ERROR"] as const;
export const ExecutionStatusSchema = z.enum(EXECUTION_STATUSES);
export type ExecutionStatus = z.infer<typeof ExecutionStatusSchema>;

export const ExecutionResponseSchema = z.object({
  /** stdout for SUCCESS/WA; compiler or runtime error text otherwise. */
  output: z.string(),
  status: ExecutionStatusSchema,
  /** Wall-clock run time of this test in ms (absent if it didn't run). */
  timeMs: z.number().int().nonnegative().optional(),
});
export type ExecutionResponse = z.infer<typeof ExecutionResponseSchema>;

/** Statuses that mean the program itself failed (not a wrong answer). */
export const FAILURE_STATUSES: readonly ExecutionStatus[] = ["TLE", "MLE", "RE", "CE", "ERROR"];

/**
 * Collapses per-test-case results into the submission's overall status:
 * the first non-passing test decides, otherwise every test passed -> Success.
 */
export function deriveSubmissionStatus(
  results: readonly ExecutionResponse[],
): SubmissionStatus {
  if (results.length === 0) return "RE";
  for (const result of results) {
    switch (result.status) {
      case "SUCCESS":
        continue;
      case "ERROR":
        return "RE";
      default:
        return result.status;
    }
  }
  return "Success";
}
