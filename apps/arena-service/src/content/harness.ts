/**
 * Python programs that wrap a student's function for judging.
 *
 * The student's code is compiled as "solution.py" in its own namespace, so
 * traceback line numbers match the editor and `if __name__ == "__main__":`
 * blocks don't run. Their print() output goes to stderr; stdout carries only
 * the JSON-encoded return value, which the evaluator compares outside the
 * sandbox. Expected outputs never enter the sandbox.
 */

export interface HarnessFunction {
  name: string;
  params: { name: string; type: string }[];
}

const b64 = (text: string) => Buffer.from(text, "utf8").toString("base64");

const PRELUDE = String.raw`
import base64 as __lx_b64, json as __lx_json, sys as __lx_sys, traceback as __lx_tb
__lx_out = __lx_sys.stdout
__lx_sys.stdout = __lx_sys.stderr

def __lx_fail(exc):
    frames = [f for f in __lx_tb.extract_tb(exc.__traceback__) if f.filename == "solution.py"]
    text = "".join(__lx_tb.format_list(frames)) + "".join(__lx_tb.format_exception_only(type(exc), exc))
    return ("Traceback (most recent call last):\n" + text) if frames else text

def __lx_convert(value, kind):
    if kind in ("ndarray", "ndarray_int"):
        import numpy as np
        return np.array(value, dtype=np.float64 if kind == "ndarray" else np.int64)
    if kind == "dataframe":
        import pandas as pd
        return pd.DataFrame(value["data"], columns=value["columns"])
    return value

def __lx_encode(v):
    if v is None or isinstance(v, (bool, str)):
        return v
    if isinstance(v, int):
        return v
    if isinstance(v, float):
        if v != v:
            return "nan"
        if v in (float("inf"), float("-inf")):
            return "inf" if v > 0 else "-inf"
        return v
    if isinstance(v, (list, tuple)):
        return [__lx_encode(x) for x in v]
    if isinstance(v, dict):
        return {str(k): __lx_encode(x) for k, x in v.items()}
    if isinstance(v, (set, frozenset)):
        return sorted(__lx_encode(x) for x in v)
    try:
        import numpy as np
        if isinstance(v, np.generic):
            return __lx_encode(v.item())
    except ImportError:
        pass
    pd = __lx_sys.modules.get("pandas")
    if pd is not None:
        if isinstance(v, pd.DataFrame):
            # Compared by columns and rows; the index is ignored.
            return {"columns": [str(c) for c in v.columns], "data": __lx_encode(v.to_numpy(dtype=object).tolist())}
        if isinstance(v, pd.Series):
            return {str(k): __lx_encode(x) for k, x in v.items()}
        if v is pd.NaT or (not isinstance(v, (list, tuple, dict)) and pd.api.types.is_scalar(v) and pd.isna(v)):
            return "nan"
    if hasattr(v, "isoformat"):
        return v.isoformat()
    if hasattr(v, "tolist"):
        return __lx_encode(v.tolist())
    raise TypeError("the return value has type " + type(v).__name__ + ", which can't be checked; return numbers, lists or arrays")

def __lx_load(source):
    import linecache
    # Lets tracebacks show the student's source lines.
    linecache.cache["solution.py"] = (len(source), None, source.splitlines(True), "solution.py")
    ns = {"__name__": "solution"}
    exec(compile(source, "solution.py", "exec"), ns)
    return ns
`;

function callBlock(fn: HarnessFunction): string {
  const kinds = JSON.stringify(fn.params.map((p) => p.type));
  return String.raw`
def __lx_call(ns, args):
    fn = ns.get(${JSON.stringify(fn.name)})
    if not callable(fn):
        raise NameError("define a function named ${fn.name}")
    kinds = __lx_json.loads(${JSON.stringify(kinds)})
    if len(args) != len(kinds):
        raise TypeError("expected ${fn.params.length} argument(s)")
    return __lx_encode(fn(*[__lx_convert(a, k) for a, k in zip(args, kinds)]))
`;
}

/** One test per run: reads {"args": [...]} from stdin, prints the result as JSON. */
export function buildJudgeProgram(fn: HarnessFunction, studentCode: string): string {
  return `${PRELUDE}${callBlock(fn)}
try:
    __lx_ns = __lx_load(__lx_b64.b64decode("${b64(studentCode)}").decode("utf-8"))
    __lx_result = __lx_call(__lx_ns, __lx_json.loads(__lx_sys.stdin.read())["args"])
except BaseException as __lx_e:
    if isinstance(__lx_e, SystemExit):
        raise
    __lx_sys.stderr.write(__lx_fail(__lx_e))
    __lx_sys.exit(1)
__lx_out.write(__lx_json.dumps(__lx_result, allow_nan=False))
`;
}

/**
 * Content build only (trusted code): runs one implementation on many cases in
 * a single process. Optionally first generates extra cases with the item's
 * `cases(rng)`. Prints {"generated": [...], "results": [{"ok", "value"|"error"}]}.
 */
export function buildBatchProgram(
  fn: HarnessFunction,
  code: string,
  cases: unknown[][],
  generator?: { source: string; seed: number },
): string {
  const gen = generator
    ? String.raw`
import numpy as __lx_np
__lx_gns = {"__name__": "generator", "np": __lx_np}
exec(compile(__lx_b64.b64decode("${b64(generator.source)}").decode("utf-8"), "generator.py", "exec"), __lx_gns)
__lx_generated = [__lx_encode(list(c)) for c in __lx_gns["cases"](__lx_np.random.default_rng(${generator.seed}))]
`
    : "\n__lx_generated = []\n";
  return `${PRELUDE}${callBlock(fn)}${gen}
__lx_cases = __lx_json.loads(__lx_b64.b64decode("${b64(JSON.stringify(cases))}").decode("utf-8")) + __lx_generated
__lx_results = []
try:
    __lx_ns = __lx_load(__lx_b64.b64decode("${b64(code)}").decode("utf-8"))
except BaseException as __lx_e:
    __lx_ns = None
    __lx_load_error = __lx_fail(__lx_e)
for __lx_args in __lx_cases:
    if __lx_ns is None:
        __lx_results.append({"ok": False, "error": __lx_load_error})
        continue
    try:
        __lx_results.append({"ok": True, "value": __lx_call(__lx_ns, __lx_args)})
    except BaseException as __lx_e:
        __lx_results.append({"ok": False, "error": __lx_fail(__lx_e)})
__lx_out.write(__lx_json.dumps({"generated": __lx_generated, "results": __lx_results}, allow_nan=False))
`;
}

const isFrame = (v: unknown): v is { columns: unknown[]; data: unknown[][] } =>
  typeof v === "object" && v !== null && Array.isArray((v as { columns?: unknown }).columns) && Array.isArray((v as { data?: unknown }).data);

/** Python-looking call for showing a sample test, e.g. dot([1, 2], [3, 4]). */
export function formatCall(name: string, args: unknown[]): string {
  return `${name}(${args.map(pyRepr).join(", ")})`;
}

export function pyRepr(value: unknown): string {
  if (value === null || value === undefined) return "None";
  if (isFrame(value)) return `<DataFrame: ${value.data.length} rows × ${value.columns.length} columns>`;
  if (value === true) return "True";
  if (value === false) return "False";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : String(value);
  if (Array.isArray(value)) return `[${value.map(pyRepr).join(", ")}]`;
  if (typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => `${JSON.stringify(k)}: ${pyRepr(v)}`)
      .join(", ")}}`;
  }
  return String(value);
}

/** Stable small integer seed from an item id. */
export function seedFor(id: string): number {
  let h = 2166136261;
  for (const ch of id) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h % 2 ** 31;
}
