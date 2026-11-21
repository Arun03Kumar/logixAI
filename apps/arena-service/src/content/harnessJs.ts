/**
 * Node programs that wrap a learner's JavaScript / React code for judging
 * (image logixai/node-web, language NODE_WEB).
 *
 * The learner's code is compiled with Sucrase (JSX and ES modules) and run as
 * "solution.js", so stack traces show the editor's line numbers. console
 * output goes to stderr; stdout carries only the JSON-encoded return value,
 * which the evaluator compares outside the sandbox.
 *
 * Items with a `driver` (JS run after the learner's code) get the names in
 * `expose` as local variables plus a `__lx` toolkit:
 *   __lx.useFakeTimers()  -> clock: replaces setTimeout/setInterval/Date.now;
 *                            `await clock.tick(ms)` runs due timers in order
 *   __lx.render(<App />)  -> { container, rerender, unmount } in jsdom
 *   __lx.click(el), __lx.type(input, value), __lx.keyDown(el, key)
 *   __lx.$(root, selector), __lx.$$(...), __lx.byText(root, text),
 *   __lx.byTestId(root, id), __lx.text(el), __lx.act(fn), __lx.flush()
 */

export interface JsHarness {
  /** The function the tests call: the learner's own, or the driver's. */
  name: string;
  /** Names the driver (or the call) needs from the learner's code. */
  expose: string[];
  driver?: string;
}

const b64 = (text: string) => Buffer.from(text, "utf8").toString("base64");

const PRELUDE = String.raw`"use strict";
const __lx_vm = require("vm");
const __lx_util = require("util");
const __lx_real = { setTimeout, clearTimeout, setInterval, clearInterval, setImmediate, dateNow: Date.now };
const __lx_write = process.stdout.write.bind(process.stdout);
for (const k of ["log", "info", "warn", "error", "debug", "trace"]) {
  console[k] = (...a) => process.stderr.write(__lx_util.format(...a) + "\n");
}
const __lx_dec = (s) => Buffer.from(s, "base64").toString("utf8");

function __lx_compile(source, file) {
  const { transform } = require("sucrase");
  try {
    return transform(source, { transforms: ["jsx", "imports"], jsxRuntime: "automatic", production: true, filePath: file }).code;
  } catch (e) {
    const err = new SyntaxError(String(e.message).replace(/^Error transforming [^:]*: /, "").replace(/\s*\(\d+:\d+\)$/, "") + (e.loc ? " (line " + e.loc.line + ", column " + (e.loc.column + 1) + ")" : ""));
    err.stack = "SyntaxError: " + err.message;
    throw err;
  }
}

function __lx_fail(e) {
  if (!(e instanceof Error)) return "Uncaught " + (typeof e === "string" ? JSON.stringify(e) : __lx_util.inspect(e));
  const frames = String(e.stack || "").split("\n").filter((l) => /solution\.js:\d+/.test(l)).map((l) => "    " + l.trim());
  return (e.name || "Error") + ": " + e.message + (frames.length ? "\n" + frames.slice(0, 8).join("\n") : "");
}

function __lx_encode(v, seen = new Set()) {
  if (v === undefined || v === null) return null;
  if (typeof v === "boolean" || typeof v === "string") return v;
  if (typeof v === "number") {
    if (Number.isNaN(v)) return "nan";
    if (!Number.isFinite(v)) return v > 0 ? "inf" : "-inf";
    return Object.is(v, -0) ? 0 : v;
  }
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "function") throw new TypeError("the return value contains a function, which can't be checked");
  if (typeof v === "symbol") throw new TypeError("the return value contains a symbol, which can't be checked");
  if (typeof v.then === "function") throw new TypeError("the return value contains a Promise: await it first");
  if (seen.has(v)) throw new TypeError("the return value is circular");
  seen.add(v);
  try {
    if (Array.isArray(v)) return v.map((x) => __lx_encode(x, seen));
    if (v instanceof Date) return v.toISOString();
    if (v instanceof Set) return [...v].map((x) => __lx_encode(x, seen));
    if (v instanceof Map) return Object.fromEntries([...v].map(([k, x]) => [String(k), __lx_encode(x, seen)]));
    if (v instanceof Error) return { error: v.name + ": " + v.message };
    if (v.$$typeof) throw new TypeError("the return value is a React element; return text or data instead");
    return Object.fromEntries(Object.keys(v).map((k) => [k, __lx_encode(v[k], seen)]));
  } finally {
    seen.delete(v);
  }
}

/* ── Fake clock ── */
function __lx_useFakeTimers(start = 0) {
  let now = start;
  let order = 0;
  let nextId = 0;
  const timers = new Map();
  const add = (fn, ms, args, repeat) => {
    if (typeof fn !== "function") throw new TypeError("setTimeout/setInterval needs a function");
    const delay = Math.max(0, Number(ms) || 0);
    const id = ++nextId;
    timers.set(id, { id, at: now + delay, order: ++order, fn, args, every: repeat ? Math.max(1, delay) : 0 });
    return id;
  };
  globalThis.setTimeout = (fn, ms, ...a) => add(fn, ms, a, false);
  globalThis.setInterval = (fn, ms, ...a) => add(fn, ms, a, true);
  globalThis.clearTimeout = globalThis.clearInterval = (id) => void timers.delete(Number(id));
  Date.now = () => now;
  try { performance.now = () => now; } catch {}
  const flush = __lx_flush;
  return {
    now: () => now,
    pending: () => timers.size,
    async tick(ms) {
      const target = now + Math.max(0, Number(ms) || 0);
      await flush();
      for (let guard = 0; guard < 100000; guard++) {
        let next = null;
        for (const t of timers.values()) {
          if (t.at <= target && (!next || t.at < next.at || (t.at === next.at && t.order < next.order))) next = t;
        }
        if (!next) break;
        now = next.at;
        if (next.every) { next.at += next.every; next.order = ++order; } else timers.delete(next.id);
        next.fn(...next.args);
        await flush();
      }
      now = target;
      await flush();
    },
    async runAll(limitMs = 3600000) {
      const end = now + limitMs;
      while (timers.size && now < end) {
        const soonest = Math.min(...[...timers.values()].map((t) => t.at));
        await this.tick(Math.max(0, soonest - now));
        if ([...timers.values()].every((t) => t.every)) break;
      }
    },
  };
}

/** Lets every pending promise callback run (one real macrotask). */
function __lx_flush() {
  return new Promise((resolve) => __lx_real.setImmediate(resolve));
}

/* ── DOM and React (loaded on first use) ── */
let __lx_window = null;
function __lx_dom() {
  if (__lx_window) return __lx_window;
  const { JSDOM } = require("jsdom");
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { pretendToBeVisual: true });
  __lx_window = dom.window;
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  for (const k of ["navigator", "HTMLElement", "HTMLInputElement", "Node", "Event", "MouseEvent", "KeyboardEvent", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame"]) {
    if (!(k in globalThis) || k === "navigator") {
      try { Object.defineProperty(globalThis, k, { value: dom.window[k], configurable: true, writable: true }); } catch {}
    }
  }
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  return __lx_window;
}

async function __lx_act(fn) {
  __lx_dom();
  const React = require("react");
  let out;
  await React.act(async () => { out = await fn(); });
  return out;
}

const __lx = {
  useFakeTimers: __lx_useFakeTimers,
  flush: __lx_flush,
  act: __lx_act,
  async render(element) {
    const win = __lx_dom();
    const { createRoot } = require("react-dom/client");
    const container = win.document.createElement("div");
    win.document.body.appendChild(container);
    const root = createRoot(container);
    await __lx_act(() => root.render(element));
    return {
      container,
      rerender: (el) => __lx_act(() => root.render(el)),
      unmount: () => __lx_act(() => root.unmount()),
    };
  },
  click(el) {
    if (!el) throw new Error("click: no such element");
    const win = __lx_dom();
    return __lx_act(() => el.dispatchEvent(new win.MouseEvent("click", { bubbles: true, cancelable: true })));
  },
  type(el, value) {
    if (!el) throw new Error("type: no such element");
    const win = __lx_dom();
    return __lx_act(() => {
      const proto = el instanceof win.HTMLTextAreaElement ? win.HTMLTextAreaElement.prototype : win.HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value").set.call(el, String(value));
      el.dispatchEvent(new win.Event("input", { bubbles: true }));
    });
  },
  keyDown(el, key) {
    if (!el) throw new Error("keyDown: no such element");
    const win = __lx_dom();
    return __lx_act(() => el.dispatchEvent(new win.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })));
  },
  $: (root, sel) => root.querySelector(sel),
  $$: (root, sel) => [...root.querySelectorAll(sel)],
  byTestId: (root, id) => root.querySelector('[data-testid="' + id + '"]'),
  byText(root, text) {
    const all = [...root.querySelectorAll("*")].filter((el) => el.textContent.trim() === text);
    return all.length ? all[all.length - 1] : null;
  },
  text: (el) => (el ? el.textContent.replace(/\s+/g, " ").trim() : null),
};

function __lx_load(source, expose) {
  const code = __lx_compile(source, "solution.jsx");
  const tail = "\n;return {" + expose.map((n) => JSON.stringify(n) + ": typeof " + n + ' === "undefined" ? undefined : ' + n).join(", ") + "};";
  const factory = __lx_vm.runInThisContext("(function (exports, require, module) {" + code + tail + "\n})", { filename: "solution.js" });
  const module = { exports: {} };
  const local = factory.call(undefined, module.exports, require, module);
  const exported = module.exports || {};
  const out = {};
  for (const n of expose) {
    out[n] = local[n] !== undefined ? local[n] : exported[n] !== undefined ? exported[n] : undefined;
  }
  // A lone \`export default\` of an anonymous function or class counts as the only missing name.
  const missing = expose.filter((n) => out[n] === undefined);
  if (missing.length === 1 && exported.default !== undefined) out[missing[0]] = exported.default;
  return out;
}

function __lx_target(h, solution) {
  if (h.driver) {
    const code = __lx_compile(h.driver, "check.jsx");
    const factory = __lx_vm.runInThisContext(
      "(function (require, __lx, __lx_solution) { const {" + h.expose.join(", ") + "} = __lx_solution;\n" + code + "\n;return " + h.name + ";\n})",
      { filename: "check.js" },
    );
    return factory(require, __lx, solution);
  }
  return solution[h.name];
}

async function __lx_run(h, source, args) {
  const solution = __lx_load(source, h.expose);
  for (const n of h.expose) {
    if (solution[n] === undefined) throw new ReferenceError("define " + n + " (as a function, class or const)");
  }
  const fn = __lx_target(h, solution);
  if (typeof fn !== "function") throw new ReferenceError(h.name + " is not a function");
  return __lx_encode(await fn(...args));
}
`;

const config = (h: JsHarness) => `const __lx_h = JSON.parse(__lx_dec("${b64(JSON.stringify(h))}"));\n`;

/** One test per run: reads {"args": [...]} from stdin, prints the result as JSON. */
export function buildJsJudgeProgram(h: JsHarness, code: string): string {
  return `${PRELUDE}${config(h)}
let __lx_done = false;
process.on("uncaughtException", (e) => {
  process.stderr.write(__lx_fail(e));
  process.exit(1);
});
process.on("exit", (code) => {
  if (!__lx_done && code === 0) {
    process.stderr.write("Your code never finished: a promise never settled or a callback was never called.");
    process.exitCode = 1;
  }
});
const __lx_input = require("fs").readFileSync(0, "utf8");
__lx_run(__lx_h, __lx_dec("${b64(code)}"), JSON.parse(__lx_input).args).then(
  (value) => {
    __lx_done = true;
    __lx_write(JSON.stringify(value), () => process.exit(0));
  },
  (e) => {
    __lx_done = true;
    process.stderr.write(__lx_fail(e));
    process.exit(1);
  },
);
`;
}

/**
 * Content build only (trusted code): runs one implementation on many cases,
 * each in its own Node process (exactly as the judge does). Prints
 * {"generated": [], "results": [{"ok", "value"|"error"}]}.
 */
export function buildJsBatchProgram(h: JsHarness, code: string, cases: unknown[][]): string {
  return `"use strict";
const fs = require("fs");
const { spawnSync } = require("child_process");
const dec = (s) => Buffer.from(s, "base64").toString("utf8");
fs.writeFileSync("/tmp/judge.js", dec("${b64(buildJsJudgeProgram(h, code))}"));
const results = JSON.parse(dec("${b64(JSON.stringify(cases))}")).map((args) => {
  const r = spawnSync(process.execPath, ["/tmp/judge.js"], { input: JSON.stringify({ args }), encoding: "utf8", timeout: 20000 });
  if (r.status === 0) return { ok: true, value: JSON.parse(r.stdout) };
  return { ok: false, error: (r.stderr || "").slice(-1500) || "exit " + r.status + (r.signal ? " (" + r.signal + ")" : "") };
});
process.stdout.write(JSON.stringify({ generated: [], results }));
`;
}

/** Content build only: runs a Python \`cases(rng)\` generator and prints the cases as JSON. */
export function buildGeneratorProgram(source: string, seed: number): string {
  return String.raw`
import base64, json
import numpy as np
def enc(v):
    if isinstance(v, np.ndarray): return enc(v.tolist())
    if isinstance(v, np.generic): return v.item()
    if isinstance(v, (list, tuple)): return [enc(x) for x in v]
    if isinstance(v, dict): return {str(k): enc(x) for k, x in v.items()}
    return v
ns = {"__name__": "generator", "np": np}
exec(compile(base64.b64decode("${b64(source)}").decode("utf-8"), "generator.py", "exec"), ns)
print(json.dumps([enc(list(c)) for c in ns["cases"](np.random.default_rng(${seed}))]))
`;
}

/** JavaScript-looking call for showing a sample test, e.g. debounce([[0, "a"]], 100). */
export function formatJsCall(name: string, args: unknown[]): string {
  return `${name}(${args.map((a) => JSON.stringify(a)).join(", ")})`;
}
