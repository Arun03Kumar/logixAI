import { z } from "zod";
import { EvaluationJobPayloadSchema } from "./queues";
import { SubmissionStatusSchema } from "./submission";

/** socket.io event names shared by socket-service and the web app. */
export const SOCKET_EVENTS = {
  /** client -> server: register the socket for a user id */
  SET_USER_ID: "setUserId",
  /** client -> server: ask for the socket id of a user */
  GET_CONNECTION_ID: "getConnectionId",
  /** server -> client: answer to GET_CONNECTION_ID */
  CONNECTION_ID: "connectionId",
  /** server -> client: judge result for a submission */
  SUBMISSION_RESULT: "submissionPayloadResponse",
} as const;

/**
 * Judge result pushed to the browser: the evaluator's per-test results plus the
 * overall status that submission-service stored on the submission.
 */
export const SubmissionResultEventSchema = EvaluationJobPayloadSchema.extend({
  status: SubmissionStatusSchema,
});
export type SubmissionResultEvent = z.infer<typeof SubmissionResultEventSchema>;

/** Body of POST /sendPayload on socket-service. */
export const SendPayloadSchema = z.object({
  userId: z.string().min(1),
  payload: SubmissionResultEventSchema,
});
export type SendPayloadInput = z.infer<typeof SendPayloadSchema>;
