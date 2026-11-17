import type { Job } from "bullmq";
import {
  SubmissionJobPayloadSchema,
  type ExecutionResponse,
  type SubmissionJobPayload,
} from "@logixai/contracts";
import type { IJob } from "../types/bullMQJobDefinition.js";
import createExecutor from "../utils/ExecutorFactory.js";
import evaluationQueueProducer from "../producers/evaluationQueueProducer.js";

export default class SubmissionJob implements IJob {
  name: string;
  payload: SubmissionJobPayload;

  constructor(payload: unknown) {
    // Validate against the shared contract: a malformed job fails loudly here.
    this.payload = SubmissionJobPayloadSchema.parse(payload);
    this.name = this.constructor.name;
  }

  handle = async (_job?: Job): Promise<void> => {
    for (const submission of Object.values(this.payload)) {
      const results: ExecutionResponse[] = [];
      const strategy = createExecutor(submission.language);

      if (strategy === null) {
        results.push({
          status: "ERROR",
          output: `Unsupported language: ${submission.language}`,
        });
      } else {
        for (const testCase of submission.testCases) {
          const response = await strategy.execute(
            submission.code,
            testCase.input,
            testCase.output,
          );
          results.push(response);
          // Keep going after a wrong answer (the UI shows every test's output),
          // but stop on a compile/runtime error or time-out.
          if (response.status === "ERROR") break;
        }
      }

      await evaluationQueueProducer({
        response: results,
        userId: submission.userId,
        submissionId: submission.submissionId,
      });
    }
  };

  failed = (job?: Job): void => {
    console.log("job failed", job?.id);
  };
}
