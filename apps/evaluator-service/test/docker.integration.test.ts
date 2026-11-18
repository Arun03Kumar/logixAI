/**
 * Real-Docker tests for the sandbox. They need Docker and the judge images,
 * so they only run with JUDGE_DOCKER_TESTS=1:
 *
 *   JUDGE_DOCKER_TESTS=1 npx vitest run test/docker.integration.test.ts
 */
import { describe, expect, it } from "vitest";
import { LANGUAGES, type LanguageId } from "@logixai/contracts";
import { judgeSubmission, type JudgeLimits } from "../src/judge/judge.js";
import { createDockerSandboxFactory } from "../src/sandbox/dockerSandbox.js";

const enabled = process.env.JUDGE_DOCKER_TESTS === "1";
const sandboxes = createDockerSandboxFactory();
const limits: JudgeLimits = {
  baseTimeLimitMs: 2000,
  compileTimeoutMs: 30_000,
  submissionBudgetMs: 60_000,
  maxOutputBytes: 64 * 1024,
};

const judge = (language: LanguageId, code: string, testCases = [{ input: "3", output: "9" }]) =>
  judgeSubmission({ language: LANGUAGES[language], code, testCases }, { sandboxes, limits });

describe.runIf(enabled)("docker sandbox", { timeout: 120_000 }, () => {
  it("accepts correct Python, C++ and Java", async () => {
    const [py, cpp, java] = await Promise.all([
      judge("PYTHON", "n = int(input())\nprint(n * n)"),
      judge("CPP", "#include <iostream>\nint main(){long n; std::cin>>n; std::cout<<n*n<<\"\\n\";}"),
      judge(
        "JAVA",
        "import java.util.*;\npublic class Main { public static void main(String[] a){ Scanner s=new Scanner(System.in); long n=s.nextLong(); System.out.println(n*n);} }",
      ),
    ]);
    expect(py.map((r) => r.status)).toEqual(["SUCCESS"]);
    expect(cpp.map((r) => r.status)).toEqual(["SUCCESS"]);
    expect(java.map((r) => r.status)).toEqual(["SUCCESS"]);
  });

  it("passes code with quotes and backslashes through unchanged", async () => {
    const res = await judge("PYTHON", "input()\nprint('it\\'s \"9\"\\\\n'[6])", [{ input: "1", output: "9" }]);
    expect(res[0]).toMatchObject({ status: "SUCCESS" });
  });

  it("reports compile errors", async () => {
    const res = await judge("CPP", "int main( { return 0; }");
    expect(res[0]!.status).toBe("CE");
    expect(res[0]!.output).toContain("error");
  });

  it("stops infinite loops with TLE", async () => {
    const res = await judge("PYTHON", "while True:\n    pass");
    expect(res[0]!.status).toBe("TLE");
  });

  it("stops memory hogs with MLE", async () => {
    const res = await judge(
      "CPP",
      "#include <vector>\nint main(){ std::vector<char*> v; while(true){ char* p = new char[1<<20]; for(int i=0;i<(1<<20);i+=4096) p[i]=1; v.push_back(p);} }",
    );
    expect(["MLE", "RE"]).toContain(res[0]!.status);
  });

  it("has no network", async () => {
    const res = await judge(
      "PYTHON",
      "import urllib.request\ninput()\nurllib.request.urlopen('http://example.com', timeout=3)\nprint(9)",
    );
    expect(res[0]!.status).toBe("RE");
  });

  it("runs as an unprivileged user on a read-only filesystem", async () => {
    const res = await judge(
      "PYTHON",
      [
        "import os",
        "input()",
        "print(os.getuid())",
        "try:",
        "    open('/etc/hacked', 'w')",
        "    print('writable')",
        "except OSError:",
        "    print('read-only')",
      ].join("\n"),
      [{ input: "1", output: "65534\nread-only" }],
    );
    expect(res[0]).toMatchObject({ status: "SUCCESS" });
  });

  it("contains fork bombs", async () => {
    const res = await judge(
      "PYTHON",
      "import os\ninput()\nwhile True:\n    try:\n        os.fork()\n    except OSError:\n        pass",
    );
    expect(["TLE", "RE", "MLE"]).toContain(res[0]!.status);
  });

  it("judges many tests quickly by compiling once", async () => {
    const testCases = Array.from({ length: 20 }, (_, i) => ({ input: String(i), output: String(i * i) }));
    const started = Date.now();
    const res = await judge(
      "CPP",
      "#include <iostream>\nint main(){long n; std::cin>>n; std::cout<<n*n;}",
      testCases,
    );
    expect(res.every((r) => r.status === "SUCCESS")).toBe(true);
    console.log(`20 C++ tests judged in ${Date.now() - started} ms`);
  });
});
