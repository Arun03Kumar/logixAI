import { describe, expect, it } from "vitest";
import { LANGUAGES } from "@logixai/contracts";
import { usesHeavyImports } from "../src/judge/forkServer.js";
import { judgeSubmission, type JudgeLimits } from "../src/judge/judge.js";
import { createDockerSandboxFactory } from "../src/sandbox/dockerSandbox.js";

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");
/** The shape of an ML Arena judge program: learner code embedded as base64. */
const arenaProgram = (learner: string, kinds = '["list"]') =>
  `import base64 as __lx_b64\ndef __lx_convert(v, k):\n    import torch\n    import pandas\n` +
  `kinds = __lx_json.loads(${JSON.stringify(kinds)})\n__lx_ns = __lx_load(__lx_b64.b64decode("${b64(learner)}").decode("utf-8"))\n`;

describe("usesHeavyImports", () => {
  it("looks at the program and at learner code embedded in it", () => {
    expect(usesHeavyImports("import torch\nprint(1)")).toBe(true);
    expect(usesHeavyImports("from sklearn.linear_model import Ridge")).toBe(true);
    expect(usesHeavyImports(arenaProgram("import torch.nn as nn\ndef f(x):\n    return x"))).toBe(true);
    expect(usesHeavyImports(arenaProgram("def f(x):\n    from scipy import stats\n    return x"))).toBe(true);
  });

  it("ignores the harness's own helper imports and light libraries", () => {
    // The harness mentions torch/pandas inside its helpers whether or not the item uses them.
    expect(usesHeavyImports(arenaProgram("import numpy as np\ndef f(x):\n    return x"))).toBe(false);
    expect(usesHeavyImports(arenaProgram("import pandas as pd\nimport duckdb\ndef f(x):\n    return x"))).toBe(false);
    expect(usesHeavyImports("n = int(input())\nprint(n * n)")).toBe(false);
    expect(usesHeavyImports("# import torch is just a comment\nx = 'import torch'")).toBe(false);
  });

  it("counts tensor arguments (the harness imports torch for them)", () => {
    expect(usesHeavyImports(arenaProgram("def f(x):\n    return x", '["tensor", "int"]'))).toBe(true);
  });
});

/*
 * Real sandboxes (JUDGE_DOCKER_TESTS=1, like docker.integration.test.ts).
 * Programs import SciPy (heavy enough to use the fork server, quick enough
 * that the direct fallback can't time out on a busy machine). Verdicts are
 * asserted directly: the old per-test path can itself time out while
 * importing, which is what the fork server fixes.
 */
const enabled = process.env.JUDGE_DOCKER_TESTS === "1";
const limits: JudgeLimits = { baseTimeLimitMs: 2000, compileTimeoutMs: 30_000, submissionBudgetMs: 60_000, maxOutputBytes: 64 * 1024 };

describe.runIf(enabled)("fork server (docker)", { timeout: 180_000 }, () => {
  const sandboxes = createDockerSandboxFactory();
  const tests = [{ input: "1", output: "2" }, { input: "5", output: "6" }, { input: "9", output: "10" }];
  const run = (code: string) =>
    judgeSubmission({ language: LANGUAGES.PYTHON_ML, code, testCases: tests }, { sandboxes, limits: { ...limits, forkServer: true } }).then(
      (r) => r.map((x) => x.status),
    );
  const head = "import sys\nimport scipy\nn = int(sys.stdin.read())\n";

  it("judges correct code", async () => {
    expect(await run(`${head}print(n + 1)
`)).toEqual(["SUCCESS", "SUCCESS", "SUCCESS"]);
  });

  it("times out an infinite loop and keeps judging", async () => {
    expect(await run(`${head}if n == 1:
    while True: pass
print(n + 1)
`)).toEqual(["TLE", "SUCCESS", "SUCCESS"]);
  });

  it("reports a non-zero exit as a runtime error", async () => {
    expect(await run(`${head}print(n + 1)
if n == 9:
    sys.exit(3)
`)).toEqual(["SUCCESS", "SUCCESS", "RE"]);
  });

  it("gives every test a fresh process (nothing carries over)", async () => {
    const code = `import builtins
${head}print('leaked' if hasattr(builtins, 'seen') else n + 1)
builtins.seen = True
`;
    expect(await run(code)).toEqual(["SUCCESS", "SUCCESS", "SUCCESS"]);
  });

  it("keeps judging after a test kills the fork server", async () => {
    expect(await run(`import os
${head}if n == 1:
    os.kill(os.getppid(), 9)
print(n + 1)
`)).toEqual(["RE", "SUCCESS", "SUCCESS"]);
  });
});
