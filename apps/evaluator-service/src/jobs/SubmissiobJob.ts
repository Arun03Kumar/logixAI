import {
  LANGUAGES,
  SubmissionJobPayloadSchema,
  type SubmissionJobPayload,
} from "@logixai/contracts";
import { judgeSubmission, type JudgeLimits } from "../judge/judge.js";
import evaluationQueueProducer from "../producers/evaluationQueueProducer.js";
import type { SandboxFactory } from "../sandbox/types.js";

export interface SubmissionJobDeps {
  sandboxes: SandboxFactory;
  limits: JudgeLimits;
  log?: (msg: string) => void;
}

/** Judges every submission in one queue job and publishes each result. */
export default class SubmissionJob {
  readonly payload: SubmissionJobPayload;

  constructor(
    payload: unknown,
    private readonly deps: SubmissionJobDeps,
  ) {
    // Validate against the shared contract: a malformed job fails loudly here.
    this.payload = SubmissionJobPayloadSchema.parse(payload);
  }

  async handle(): Promise<void> {
    for (const submission of Object.values(this.payload)) {
      const response = await judgeSubmission(
        {
          language: LANGUAGES[submission.language],
          code: submission.code,
          testCases: submission.testCases,
          checker: submission.checker,
        },
        this.deps,
      );
      await evaluationQueueProducer(
        { response, userId: submission.userId, submissionId: submission.submissionId },
        submission.replyQueue,
      );
    }
  }
}
