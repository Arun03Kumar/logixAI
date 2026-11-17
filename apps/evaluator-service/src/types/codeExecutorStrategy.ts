export default interface CodeExecutorStrategy {
  execute(
    code: string,
    inputTestCase: string,
    outputTestCase?: string
  ): Promise<ExecutionResponse>;
}

export type { ExecutionResponse } from "@logixai/contracts";
import type { ExecutionResponse } from "@logixai/contracts";
