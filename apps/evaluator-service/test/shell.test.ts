import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { buildRunCommand, shellQuote } from "../src/utils/shell.js";

// Run a script through a real POSIX shell when one is available
// (Git Bash on Windows, /bin/sh on Linux CI). The script goes in on stdin
// because Windows argv quoting would mangle backslashes.
function sh(script: string): string | null {
  try {
    return execFileSync("sh", ["-s"], { input: script, encoding: "utf8" });
  } catch {
    return null;
  }
}
const hasShell = sh("printf ok") === "ok";

describe("shellQuote", () => {
  it("wraps in single quotes and escapes embedded quotes", () => {
    expect(shellQuote("it's")).toBe(`'it'\\''s'`);
  });

  it.runIf(hasShell)("round-trips tricky code through sh unchanged", () => {
    const code = `char c = '\\n'; printf("%d\\n", x); $HOME \`id\` "q" \\\\`;
    expect(sh(`printf '%s' ${shellQuote(code)}`)).toBe(code);
  });
});

describe("buildRunCommand", () => {
  it("writes, compiles and runs using the language registry", () => {
    const cmd = buildRunCommand("CPP", "int main(){}", "5");
    expect(cmd).toContain("> main.cpp");
    expect(cmd).toContain("&& g++ main.cpp -o main &&");
    expect(cmd).toMatch(/\| stdbuf -oL -eL \.\/main$/);
  });

  it("skips the compile step for interpreted languages", () => {
    const cmd = buildRunCommand("PYTHON", "print(input())", "5");
    expect(cmd.split(" && ")).toHaveLength(2);
    expect(cmd).toMatch(/\| python3 test\.py$/);
  });

  it.runIf(hasShell)("delivers code and input byte-for-byte", () => {
    const code = `print('it\\'s', "a\\nb")`;
    const input = "line1\nit's 'quoted'";
    // Swap the real program for cat so we can see what it would receive.
    const script = buildRunCommand("PYTHON", code, input).replace(
      "python3 test.py",
      "{ cat test.py; printf '%s' '---'; cat; }",
    );
    const dir = execFileSync("mktemp", ["-d"], { encoding: "utf8" }).trim();
    const out = sh(`cd '${dir}' && ${script}`);
    expect(out).toBe(`${code}\n---${input}\n`);
  });
});
