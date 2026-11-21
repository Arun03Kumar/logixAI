/**
 * Content build helper: runs Python (ML judge image) or Node (JavaScript judge
 * image) with no network and limited memory. Only for trusted content
 * (reference solutions, starters, snippets); students' code always goes
 * through evaluator-service.
 */
import { spawn } from "node:child_process";

export const IMAGE = "logixai/python-ml:4";
export const NODE_IMAGE = "logixai/node-web:1";

export interface PythonRun {
  exitCode: number;
  stdout: string;
  stderr: string;
}

const b64 = (text: string) => Buffer.from(text, "utf8").toString("base64");

/** Runs `program` with `input` on its stdin. Both travel base64-encoded in a small shell script. */
export function runPython(program: string, input = "", timeoutMs = 180_000): Promise<PythonRun> {
  return runIn(IMAGE, "main.py", "python3 -B main.py", program, input, timeoutMs);
}

/** Runs a Node program in the JavaScript judge image. */
export function runNode(program: string, input = "", timeoutMs = 300_000): Promise<PythonRun> {
  return runIn(NODE_IMAGE, "main.js", "node main.js", program, input, timeoutMs);
}

function runIn(image: string, file: string, command: string, program: string, input: string, timeoutMs: number): Promise<PythonRun> {
  const script = [
    "set -e",
    "cd /tmp",
    `echo '${b64(program)}' | base64 -d > ${file}`,
    `echo '${b64(input)}' | base64 -d > input.txt`,
    `${command} < input.txt`,
  ].join("\n");
  return new Promise((resolve, reject) => {
    const child = spawn(
      "docker",
      ["run", "--rm", "-i", "--network", "none", "--memory", "1g", "--cpus", "1", image, "sh", "-s"],
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
