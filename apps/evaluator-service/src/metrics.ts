import { metrics } from "@logixai/service-kit";

/** Judge metrics, on the evaluator's /metrics (with the shared HTTP and process series). */

/** Seconds a job waited in its queue before an evaluator took it. */
export const queueWait = metrics.histogram(
  "judge_queue_wait_seconds",
  "Time a judge job waited in its queue before being picked up.",
  [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60, 120],
);

/** Seconds to judge one submission (sandbox, compile, every test). */
export const judgeDuration = metrics.histogram(
  "judge_submission_duration_seconds",
  "Time to judge one submission, by language and overall verdict.",
  [0.25, 0.5, 1, 2, 3, 5, 8, 13, 21, 34, 60],
);

export const judgedTotal = metrics.counter("judge_submissions_total", "Submissions judged, by language and overall verdict.");

/** The overall verdict of a submission: SUCCESS when every test passed, else the first other one. */
export function overallVerdict(statuses: string[]): string {
  return statuses.find((s) => s !== "SUCCESS") ?? (statuses.length ? "SUCCESS" : "ERROR");
}
