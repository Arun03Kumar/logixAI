import { z } from "zod";
import { LanguageIdSchema } from "./common";

/** Status stored on a Submission document. */
export const SUBMISSION_STATUSES = [
  "Pending",
  "Success",
  "RE",
  "TLE",
  "MLE",
  "WA",
] as const;
export const SubmissionStatusSchema = z.enum(SUBMISSION_STATUSES);
export type SubmissionStatus = z.infer<typeof SubmissionStatusSchema>;

/** Body of POST /api/v1/submission */
export const CreateSubmissionSchema = z.object({
  userId: z.string().min(1),
  problemId: z.string().min(1),
  code: z.string(),
  language: z
    .string()
    .transform((value) => value.toUpperCase())
    .pipe(LanguageIdSchema),
});
export type CreateSubmissionInput = z.infer<typeof CreateSubmissionSchema>;

/** Result of running the code against one test case (produced by the evaluator). */
export const EXECUTION_STATUSES = ["SUCCESS", "WA", "ERROR"] as const;
export const ExecutionStatusSchema = z.enum(EXECUTION_STATUSES);
export type ExecutionStatus = z.infer<typeof ExecutionStatusSchema>;

export const ExecutionResponseSchema = z.object({
  output: z.string(),
  status: ExecutionStatusSchema,
});
export type ExecutionResponse = z.infer<typeof ExecutionResponseSchema>;

/** Output the evaluator reports when a run hits the time limit. */
export const TIME_LIMIT_OUTPUT = "TLE";

/**
 * Collapses per-test-case results into the submission's overall status:
 * the first failing test decides (ERROR -> RE or TLE, WA -> WA),
 * otherwise every test passed -> Success.
 */
export function deriveSubmissionStatus(
  results: readonly ExecutionResponse[],
): SubmissionStatus {
  if (results.length === 0) return "RE";
  for (const result of results) {
    if (result.status === "ERROR") {
      return result.output === TIME_LIMIT_OUTPUT ? "TLE" : "RE";
    }
    if (result.status === "WA") return "WA";
  }
  return "Success";
}
