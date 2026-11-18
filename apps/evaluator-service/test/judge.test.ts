import { describe, expect, it, vi } from "vitest";
import { LANGUAGES } from "@logixai/contracts";
import { judgeSubmission, type JudgeLimits } from "../src/judge/judge.js";
import type { ExecResult, Sandbox } from "../src/sandbox/types.js";

const LIMITS: JudgeLimits = {
  baseTimeLimitMs: 1000,
  compileTimeoutMs: 5000,
  submissionBudgetMs: 60_000,
  maxOutputBytes: 1024,
};

const ok = (stdout: string, extra: Partial<ExecResult> = {}): ExecResult => ({
  exitCode: 0,
  stdout,
  stderr: "",
  timedOut: false,
  outputLimited: false,
  durationMs: 12,
  ...extra,
});

const isWrite = (cmd: string[]) => cmd[0] === "sh" && /^cat > /.test(cmd[2] ?? "");

/**
 * Fake sandbox with a tiny filesystem: `cat > file` stores stdin, and every
 * other command is answered by `run(cmd, files)`.
 */
function fakeSandboxes(run: (cmd: string[], files: Record<string, string>) => ExecResult) {
  const files: Record<string, string> = {};
  const calls: string[][] = [];
  const destroy = vi.fn(async () => {});
  const sandbox: Sandbox = {
    exec: vi.fn(async (cmd, opts) => {
      calls.push(cmd);
      if (isWrite(cmd)) {
        files[cmd[2]!.slice("cat > ".length)] = opts.stdin ?? "";
        return ok("");
      }
      return run(cmd, files);
    }),
    destroy,
  };
  return { calls, files, destroy, factory: { create: vi.fn(async () => sandbox) } };
}

const square = (_: string[], files: Record<string, string>) => ok(String(Number(files["input.txt"]) ** 2));

const tests = [
  { input: "2", output: "4" },
  { input: "3", output: "9" },
];

describe("judgeSubmission", () => {
  it("writes the code, compiles once and runs every test in one sandbox", async () => {
    const { calls, files, destroy, factory } = fakeSandboxes((cmd, f) =>
      cmd.join(" ").includes("g++") ? ok("") : square(cmd, f),
    );
    const res = await judgeSubmission(
      { language: LANGUAGES.CPP, code: "int main(){}", testCases: tests },
      { sandboxes: factory, limits: LIMITS },
    );
    expect(res.map((r) => r.status)).toEqual(["SUCCESS", "SUCCESS"]);
    expect(factory.create).toHaveBeenCalledTimes(1);
    expect(files["main.cpp"]).toBe("int main(){}");
    expect(calls.filter((c) => c.join(" ").includes("g++"))).toHaveLength(1);
    // Each run reads the input file, never stdin.
    expect(calls.filter((c) => c.join(" ").includes("./main < input.txt"))).toHaveLength(2);
    expect(files["input.txt"]).toBe("3\n"); // trailing newline added
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("scales the time limit by language", async () => {
    const { calls, factory } = fakeSandboxes(square);
    await judgeSubmission(
      { language: LANGUAGES.PYTHON, code: "print(4)", testCases: [tests[0]!] },
      { sandboxes: factory, limits: LIMITS },
    );
    const run = calls.find((c) => c[0] === "timeout")!;
    expect(run.slice(0, 4)).toEqual(["timeout", "-k", "1", "3.00"]); // 1000 ms × 3
  });

  it("reports a compile error once and runs no tests", async () => {
    const { calls, factory } = fakeSandboxes((cmd) =>
      cmd.join(" ").includes("g++")
        ? { ...ok(""), exitCode: 1, stderr: "main.cpp:1: error: expected ';'" }
        : ok(""),
    );
    const res = await judgeSubmission(
      { language: LANGUAGES.CPP, code: "int main(){", testCases: tests },
      { sandboxes: factory, limits: LIMITS },
    );
    expect(res).toEqual([{ status: "CE", output: "main.cpp:1: error: expected ';'" }]);
    expect(calls.some((c) => c.join(" ").includes("input.txt"))).toBe(false);
  });

  it("maps exit codes to verdicts and keeps judging after a failure", async () => {
    const limitMs = 3000; // Python: 1000 ms × 3
    const outcomes: Partial<ExecResult>[] = [
      { exitCode: 124 }, // timeout -> TLE
      { exitCode: 137, durationMs: 400 }, // killed early: OOM -> MLE
      { exitCode: 137, durationMs: limitMs + 900 }, // killed by timeout -k -> TLE
      { exitCode: 1, stderr: "Traceback: ZeroDivisionError" }, // RE
      { outputLimited: true }, // RE (output limit)
      { exitCode: null, timedOut: true }, // watchdog -> TLE
      { stdout: "wrong" }, // WA
    ];
    let i = 0;
    const { factory } = fakeSandboxes(() => ok("", outcomes[i++]));
    const res = await judgeSubmission(
      {
        language: LANGUAGES.PYTHON,
        code: "x",
        testCases: outcomes.map(() => ({ input: "1", output: "1" })),
      },
      { sandboxes: factory, limits: LIMITS },
    );
    expect(res.map((r) => r.status)).toEqual(["TLE", "MLE", "TLE", "RE", "RE", "TLE", "WA"]);
    expect(res[3]!.output).toContain("ZeroDivisionError");
    expect(res[4]!.output).toBe("Output limit exceeded.");
  });

  it("skips the remaining tests once the submission's time budget is used", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { factory } = fakeSandboxes((cmd, files) => {
      vi.setSystemTime(Date.now() + 40_000);
      return square(cmd, files);
    });
    const res = await judgeSubmission(
      { language: LANGUAGES.PYTHON, code: "x", testCases: [tests[0]!, tests[0]!, tests[0]!] },
      { sandboxes: factory, limits: LIMITS },
    );
    vi.useRealTimers();
    expect(res.map((r) => r.status)).toEqual(["SUCCESS", "SUCCESS", "TLE"]);
  });

  it("returns a judge error (not a student error) when the sandbox can't start", async () => {
    const res = await judgeSubmission(
      { language: LANGUAGES.PYTHON, code: "x", testCases: tests },
      { sandboxes: { create: async () => Promise.reject(new Error("docker down")) }, limits: LIMITS },
    );
    expect(res).toEqual([expect.objectContaining({ status: "ERROR" })]);
  });

  it("always destroys the sandbox, even if exec throws", async () => {
    const destroy = vi.fn(async () => {});
    const factory = {
      create: async () => ({
        exec: async () => {
          throw new Error("connection reset");
        },
        destroy,
      }),
    };
    const res = await judgeSubmission(
      { language: LANGUAGES.PYTHON, code: "x", testCases: tests },
      { sandboxes: factory, limits: LIMITS },
    );
    expect(res[0]!.status).toBe("ERROR");
    expect(destroy).toHaveBeenCalledTimes(1);
  });
});
