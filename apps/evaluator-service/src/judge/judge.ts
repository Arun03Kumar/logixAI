import type { ExecutionResponse, LanguageDefinition, TestCase } from "@logixai/contracts";
import type { ExecResult, SandboxFactory } from "../sandbox/types.js";
import { outputsMatch } from "./compare.js";

export interface JudgeLimits {
  /** Per-test time limit before the language multiplier. */
  baseTimeLimitMs: number;
  compileTimeoutMs: number;
  /** Total time for all tests of one submission; later tests are skipped as TLE. */
  submissionBudgetMs: number;
  /** stdout/stderr kept per test. */
  maxOutputBytes: number;
}

export const DEFAULT_LIMITS: JudgeLimits = {
  baseTimeLimitMs: 2000,
  compileTimeoutMs: 20_000,
  submissionBudgetMs: 60_000,
  maxOutputBytes: 64 * 1024,
};

/** Where each test's input is written inside the sandbox. */
const INPUT_FILE = "input.txt";

/** Seconds after the in-container `timeout` before the host gives up. */
const WATCHDOG_SLACK_MS = 3000;
/** Longest message (compiler errors, stack traces) sent back to the user. */
const MAX_MESSAGE_CHARS = 4000;

/** Exit code of GNU `timeout` when the command ran out of time. */
const EXIT_TIMEOUT = 124;
/** 128 + SIGKILL: killed from outside the program, here the kernel OOM killer. */
const EXIT_KILLED = 137;

const clip = (text: string) =>
  text.length > MAX_MESSAGE_CHARS ? `${text.slice(0, MAX_MESSAGE_CHARS)}\n… (truncated)` : text;

/**
 * `timeout` inside the container enforces the limit on the program itself:
 * TERM at the limit (exit 124), KILL one second later if it's ignored.
 */
const withTimeout = (ms: number, command: string) => [
  "timeout",
  "-k",
  "1",
  (ms / 1000).toFixed(2),
  "sh",
  "-c",
  command,
];

export function verdictFor(result: ExecResult, expected: string, timeLimitMs: number): ExecutionResponse {
  const timeMs = result.durationMs;
  if (result.timedOut || result.exitCode === EXIT_TIMEOUT) {
    return { status: "TLE", output: "", timeMs };
  }
  if (result.exitCode === EXIT_KILLED) {
    // SIGKILL at or after the limit came from `timeout -k`; before it, from the OOM killer.
    return { status: timeMs >= timeLimitMs ? "TLE" : "MLE", output: "", timeMs };
  }
  if (result.outputLimited) {
    return { status: "RE", output: "Output limit exceeded.", timeMs };
  }
  if (result.exitCode !== 0) {
    const message = result.stderr.trim() || `Your program exited with code ${result.exitCode}.`;
    return { status: "RE", output: clip(message), timeMs };
  }
  return {
    status: outputsMatch(expected, result.stdout) ? "SUCCESS" : "WA",
    output: clip(result.stdout),
    timeMs,
  };
}

/**
 * Judges one submission: writes the code, compiles once, runs every test in
 * the same sandbox and returns one verdict per test (or a single CE / ERROR).
 */
export async function judgeSubmission(
  input: { language: LanguageDefinition; code: string; testCases: TestCase[] },
  deps: { sandboxes: SandboxFactory; limits?: JudgeLimits; log?: (msg: string) => void },
): Promise<ExecutionResponse[]> {
  const limits = deps.limits ?? DEFAULT_LIMITS;
  const { language } = input;
  const timeLimitMs = Math.round(limits.baseTimeLimitMs * language.timeMultiplier);

  let sandbox;
  try {
    sandbox = await deps.sandboxes.create(language);
  } catch (err) {
    deps.log?.(`Sandbox start failed: ${(err as Error).message}`);
    return [{ status: "ERROR", output: "The judge couldn't start your code. Try again in a moment." }];
  }

  try {
    const write = await sandbox.exec(["sh", "-c", `cat > ${language.sourceFile}`], {
      stdin: input.code,
      timeoutMs: 10_000,
      maxOutputBytes: 4096,
    });
    if (write.exitCode !== 0) {
      deps.log?.(`Writing source failed: ${write.stderr}`);
      return [{ status: "ERROR", output: "The judge couldn't save your code. Try again." }];
    }

    if (language.compileCommand) {
      const compile = await sandbox.exec(withTimeout(limits.compileTimeoutMs, language.compileCommand), {
        timeoutMs: limits.compileTimeoutMs + WATCHDOG_SLACK_MS,
        maxOutputBytes: limits.maxOutputBytes,
      });
      if (compile.timedOut || compile.exitCode === EXIT_TIMEOUT) {
        return [{ status: "CE", output: "Compilation took too long." }];
      }
      if (compile.exitCode !== 0) {
        return [{ status: "CE", output: clip((compile.stderr || compile.stdout).trim()) }];
      }
    }

    const started = Date.now();
    const results: ExecutionResponse[] = [];
    for (const testCase of input.testCases) {
      if (Date.now() - started > limits.submissionBudgetMs) {
        results.push({ status: "TLE", output: "Not run: the submission used up its total time." });
        continue;
      }
      // The program reads its input from a file (see DockerSandbox.exec).
      const input = testCase.input.endsWith("\n") ? testCase.input : `${testCase.input}\n`;
      const written = await sandbox.exec(["sh", "-c", `cat > ${INPUT_FILE}`], {
        stdin: input,
        timeoutMs: 10_000,
        maxOutputBytes: 1024,
      });
      if (written.exitCode !== 0) {
        results.push({ status: "ERROR", output: "The judge couldn't prepare this test." });
        continue;
      }
      const run = await sandbox.exec(withTimeout(timeLimitMs, `${language.runCommand} < ${INPUT_FILE}`), {
        timeoutMs: timeLimitMs + WATCHDOG_SLACK_MS,
        maxOutputBytes: limits.maxOutputBytes,
      });
      results.push(verdictFor(run, testCase.output, timeLimitMs));
    }
    return results;
  } catch (err) {
    deps.log?.(`Judging failed: ${(err as Error).message}`);
    return [{ status: "ERROR", output: "The judge hit a problem running your code. Try again." }];
  } finally {
    await sandbox.destroy().catch(() => {});
  }
}
