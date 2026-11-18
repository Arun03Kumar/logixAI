import { z } from "zod";
import { EvaluationJobPayloadSchema } from "./queues";
import { SUBMISSION_MODES, SubmissionStatusSchema } from "./submission";

/**
 * socket.io event names shared by socket-service and the web app.
 * Clients authenticate with `io(url, { auth: { token: <access token> } })`;
 * the user id comes from the token, so there is no "register user" event.
 */
export const SOCKET_EVENTS = {
  /** server -> client: judge result for a submission */
  SUBMISSION_RESULT: "submissionPayloadResponse",
} as const;

/**
 * Judge result pushed to the browser: the evaluator's per-test results plus the
 * overall status that submission-service stored on the submission.
 */
export const SubmissionResultEventSchema = EvaluationJobPayloadSchema.extend({
  status: SubmissionStatusSchema,
  mode: z.enum(SUBMISSION_MODES).optional(),
  /**
   * The first `sampleCount` results are sample tests (shown with output);
   * the rest are hidden tests, whose output is blanked before sending.
   */
  sampleCount: z.number().int().nonnegative().optional(),
});
export type SubmissionResultEvent = z.infer<typeof SubmissionResultEventSchema>;

/** Body of POST /sendPayload on socket-service. */
export const SendPayloadSchema = z.object({
  userId: z.string().min(1),
  payload: SubmissionResultEventSchema,
});
export type SendPayloadInput = z.infer<typeof SendPayloadSchema>;
