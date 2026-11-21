"use client";
// Instant Run in the browser (production plan S3).
//
// Runs an ML Arena item's sample tests in Pyodide inside a Web Worker
// (public/arena-runner/worker.js), using the judge's own program from
// GET /items/:id/runner and the judge's own comparison (jsonOutputsMatch).
// Only items the server marks runIn: "browser" come here, and only for Run;
// Submit always goes to the judge. Results have the same shape as a judge
// submission, so the page shows them the same way.
import { jsonOutputsMatch } from "@logixai/contracts/dist/checker";

/** Starting Pyodide and loading packages the first time can take a while on slow connections. */
const LOAD_TIMEOUT_MS = 120_000;

let worker = null;
let engine = null; // Promise resolved when Pyodide is loaded in `worker`
let nextId = 1;
const waiting = new Map();

export function browserRunSupported() {
  return typeof window !== "undefined" && typeof Worker !== "undefined" && typeof WebAssembly === "object";
}

function stopWorker(reason) {
  if (worker) worker.terminate();
  worker = null;
  engine = null;
  for (const { reject, timer } of waiting.values()) {
    clearTimeout(timer);
    reject(reason);
  }
  waiting.clear();
}

function startWorker() {
  worker = new Worker("/arena-runner/worker.js");
  worker.onmessage = ({ data }) => {
    const entry = waiting.get(data.id);
    if (!entry) return;
    waiting.delete(data.id);
    clearTimeout(entry.timer);
    if (data.ok) entry.resolve(data.result);
    else entry.reject(new Error(data.error));
  };
  worker.onerror = (event) => stopWorker(new Error(event.message || "The browser runner stopped."));
}

/** Sends one message; on timeout the worker is stopped (Python can't be interrupted otherwise). */
function call(type, payload, timeoutMs) {
  if (!worker) startWorker();
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const err = new Error("timeout");
      err.timeout = true;
      stopWorker(err);
    }, timeoutMs);
    waiting.set(id, { resolve, reject, timer });
    worker.postMessage({ id, type, ...payload });
  });
}

function ensureEngine(version) {
  if (!engine) {
    engine = call("init", { version }, LOAD_TIMEOUT_MS).catch((err) => {
      stopWorker(err);
      throw err;
    });
  }
  return engine;
}

/** Starts downloading Pyodide early (e.g. when the learner focuses the editor). */
export function warmUp(version) {
  if (!browserRunSupported()) return;
  ensureEngine(version).catch(() => {});
}

function base64Utf8(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/**
 * Runs `code` against the kit's sample tests. `onStatus(text)` reports progress.
 * Returns a submission-shaped result: { status, passed, total, tests, ranIn: "browser", ... }.
 * Throws if the engine can't start (the caller then runs on the server).
 */
export async function runInBrowser(kit, code, onStatus = () => {}) {
  onStatus("Starting Python in your browser…");
  await ensureEngine(kit.pyodideVersion);
  const program = kit.program.replace(kit.placeholder, base64Utf8(code));
  onStatus("Loading packages…");
  await call("prepare", { sources: kit.codeLanguage === "python" ? [program, code] : [program] }, LOAD_TIMEOUT_MS);

  const tests = [];
  for (const [index, t] of kit.tests.entries()) {
    onStatus(`Running example ${index + 1} of ${kit.tests.length}…`);
    const base = { index, sample: true, call: t.call, expected: t.expectedText };
    let r;
    try {
      r = await call("run", { program, input: t.input }, kit.timeLimitMs);
    } catch (err) {
      if (!err.timeout) throw err;
      // The worker was stopped; the remaining examples aren't run.
      tests.push({ ...base, verdict: "TLE", message: `Stopped after ${kit.timeLimitMs / 1000} s.` });
      break;
    }
    const printed = r.exitOk ? r.stderr.trim() : "";
    if (!r.exitOk) {
      tests.push({ ...base, verdict: "RE", timeMs: r.timeMs, message: r.stderr.trim() || "Your code stopped with an error." });
    } else if (jsonOutputsMatch(t.expected, r.stdout, kit.tolerance)) {
      tests.push({ ...base, verdict: "SUCCESS", timeMs: r.timeMs, output: r.stdout.trim(), ...(printed ? { printed } : {}) });
    } else {
      tests.push({ ...base, verdict: "WA", timeMs: r.timeMs, output: r.stdout.trim(), ...(printed ? { printed } : {}) });
    }
  }

  const passed = tests.filter((t) => t.verdict === "SUCCESS").length;
  const now = new Date().toISOString();
  return {
    id: `browser-${Date.now()}`,
    itemId: kit.itemId,
    mode: "run",
    status: passed === kit.tests.length ? "passed" : "failed",
    passed,
    total: kit.tests.length,
    tests,
    xpGained: 0,
    createdAt: now,
    judgedAt: now,
    ranIn: "browser",
  };
}
