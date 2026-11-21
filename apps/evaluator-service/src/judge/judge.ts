import type { Checker, ExecutionResponse, LanguageDefinition, TestCase } from "@logixai/contracts";
import type { ExecResult, Sandbox, SandboxFactory } from "../sandbox/types.js";
import { formatScore, jsonOutputsMatch, metricPasses, metricScore } from "@logixai/contracts";
import { outputsMatch } from "./compare.js";
import {
  CLIENT_FILE,
  CLIENT_PY,
  FORK_DIR,
  ZYGOTE_FILE,
  ZYGOTE_PY,
  clientCommand,
  startZygoteCommand,
  usesHeavyImports,
  waitForZygoteCommand,
} from "./forkServer.js";

export interface JudgeLimits {
  /** Per-test time limit before the language multiplier. */
  baseTimeLimitMs: number;
  compileTimeoutMs: number;
  /** Total time for all tests of one submission; later tests are skipped as TLE. */
  submissionBudgetMs: number;
  /** stdout/stderr kept per test. */
  maxOutputBytes: number;
  /** Run heavy Python tests through the fork server (see forkServer.ts). Default true. */
  forkServer?: boolean;
}

export const DEFAULT_LIMITS: JudgeLimits = {
  baseTimeLimitMs: 2000,
  compileTimeoutMs: 20_000,
  submissionBudgetMs: 60_000,
  maxOutputBytes: 64 * 1024,
};

/** Languages whose imports are slow enough to be worth a fork server. */
const FORK_SERVER_LANGUAGES = new Set(["PYTHON_ML"]);
/** Longest the fork server may take to import its libraries (PyTorch ~4.5 s). */
const FORK_SERVER_START_SECONDS = 30;

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

const LINES: Checker = { kind: "lines" };

function matches(checker: Checker, expected: string, actual: string): boolean {
  return checker.kind === "json" ? jsonOutputsMatch(expected, actual, checker) : outputsMatch(expected, actual);
}

export function verdictFor(
  result: ExecResult,
  expected: string,
  timeLimitMs: number,
  checker: Checker = LINES,
): ExecutionResponse {
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
  if (checker.kind === "metric") return scored(checker, expected, result.stdout, timeMs);
  return {
    status: matches(checker, expected, result.stdout) ? "SUCCESS" : "WA",
    output: clip(result.stdout),
    timeMs,
  };
}

/** Dataset challenges: score the printed predictions against the hidden labels. */
function scored(
  checker: Extract<Checker, { kind: "metric" }>,
  expected: string,
  stdout: string,
  timeMs: number,
): ExecutionResponse {
  let truth: unknown;
  let predicted: unknown;
  try {
    truth = JSON.parse(expected);
    predicted = JSON.parse(stdout.trim());
  } catch {
    return { status: "WA", output: "Return a list with one prediction per row.", timeMs };
  }
  const score = Array.isArray(truth) ? metricScore(checker.metric, truth, predicted) : null;
  if (score === null) {
    const got = Array.isArray(predicted) ? `${predicted.length} predictions` : "something that isn't a list";
    const want = Array.isArray(truth) ? truth.length : 0;
    return { status: "WA", output: `Expected ${want} numeric predictions, got ${got}.`, timeMs };
  }
  const passes = metricPasses(checker.metric, score, checker.threshold);
  // Only the score goes back, never the labels.
  return { status: passes ? "SUCCESS" : "WA", output: formatScore(checker.metric, score), timeMs };
}

/**
 * Judges one submission: writes the code, compiles once, runs every test in
 * the same sandbox and returns one verdict per test (or a single CE / ERROR).
 */
export async function judgeSubmission(
  input: { language: LanguageDefinition; code: string; testCases: TestCase[]; checker?: Checker },
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

    // Heavy Python: import the libraries once, then fork a fresh process per test.
    let runCommand = language.runCommand;
    if ((limits.forkServer ?? true) && FORK_SERVER_LANGUAGES.has(language.id) && usesHeavyImports(input.code)) {
      if (await startForkServer(sandbox, language.sourceFile, deps.log)) runCommand = clientCommand(language.sourceFile);
    }

    const started = Date.now();
    const results: ExecutionResponse[] = [];
    for (const testCase of input.testCases) {
      if (Date.now() - started > limits.submissionBudgetMs) {
        results.push({ status: "TLE", output: "Not run: the submission used up its total time." });
        continue;
      }
      // The program reads its input from a file (see DockerSandbox.exec).
      const testInput = testCase.input.endsWith("\n") ? testCase.input : `${testCase.input}\n`;
      const written = await sandbox.exec(["sh", "-c", `cat > ${INPUT_FILE}`], {
        stdin: testInput,
        timeoutMs: 10_000,
        maxOutputBytes: 1024,
      });
      if (written.exitCode !== 0) {
        results.push({ status: "ERROR", output: "The judge couldn't prepare this test." });
        continue;
      }
      const run = await sandbox.exec(withTimeout(timeLimitMs, `${runCommand} < ${INPUT_FILE}`), {
        timeoutMs: timeLimitMs + WATCHDOG_SLACK_MS,
        maxOutputBytes: limits.maxOutputBytes,
      });
      results.push(verdictFor(run, testCase.output, timeLimitMs, input.checker));
    }
    return results;
  } catch (err) {
    deps.log?.(`Judging failed: ${(err as Error).message}`);
    return [{ status: "ERROR", output: "The judge hit a problem running your code. Try again." }];
  } finally {
    await sandbox.destroy().catch(() => {});
  }
}

/**
 * Writes and starts the fork server, and waits until it listens. Returns
 * false if it doesn't start (then tests run the program directly, as before).
 */
async function startForkServer(sandbox: Sandbox, sourceFile: string, log?: (msg: string) => void): Promise<boolean> {
  const write = (file: string, text: string) =>
    sandbox.exec(["sh", "-c", `mkdir -p ${FORK_DIR} && cat > ${file}`], { stdin: text, timeoutMs: 10_000, maxOutputBytes: 1024 });
  try {
    if ((await write(ZYGOTE_FILE, ZYGOTE_PY)).exitCode !== 0 || (await write(CLIENT_FILE, CLIENT_PY)).exitCode !== 0) return false;
    await sandbox.exec(["sh", "-c", startZygoteCommand(sourceFile)], { timeoutMs: 10_000, maxOutputBytes: 1024 });
    const ready = await sandbox.exec(["sh", "-c", waitForZygoteCommand(FORK_SERVER_START_SECONDS)], {
      timeoutMs: (FORK_SERVER_START_SECONDS + 5) * 1000,
      maxOutputBytes: 1024,
    });
    if (ready.exitCode === 0) return true;
    log?.("Fork server didn't start; running tests directly");
    return false;
  } catch (err) {
    log?.(`Fork server failed: ${(err as Error).message}`);
    return false;
  }
}
