/**
 * Content build helper: runs Python in the ML judge image (no network, limited
 * memory). Only for trusted content (reference solutions, starters, snippets);
 * students' code always goes through evaluator-service.
 */
import { spawn } from "node:child_process";

export const IMAGE = "logixai/python-ml:1";

export interface PythonRun {
  exitCode: number;
  stdout: string;
  stderr: string;
}

const b64 = (text: string) => Buffer.from(text, "utf8").toString("base64");

/** Runs `program` with `input` on its stdin. Both travel base64-encoded in a small shell script. */
export function runPython(program: string, input = "", timeoutMs = 180_000): Promise<PythonRun> {
  const script = [
    "set -e",
    "cd /tmp",
    `echo '${b64(program)}' | base64 -d > main.py`,
    `echo '${b64(input)}' | base64 -d > input.txt`,
    "python3 -B main.py < input.txt",
  ].join("\n");
  return new Promise((resolve, reject) => {
    const child = spawn(
      "docker",
      ["run", "--rm", "-i", "--network", "none", "--memory", "1g", "--cpus", "1", IMAGE, "sh", "-s"],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ exitCode: code ?? -1, stdout, stderr });
    });
    child.stdin.end(script);
  });
}
