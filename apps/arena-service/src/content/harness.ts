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

def __lx_torch():
    import torch
    torch.set_num_threads(1)
    return torch

def __lx_convert(value, kind):
    if kind in ("ndarray", "ndarray_int"):
        import numpy as np
        return np.array(value, dtype=np.float64 if kind == "ndarray" else np.int64)
    if kind in ("tensor", "tensor_int"):
        torch = __lx_torch()
        return torch.tensor(value, dtype=torch.float32 if kind == "tensor" else torch.int64)
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
    torch = __lx_sys.modules.get("torch")
    if torch is not None and isinstance(v, torch.Tensor):
        return __lx_encode(v.detach().cpu().tolist())
    if hasattr(v, "isoformat"):
        return v.isoformat()
    if hasattr(v, "tolist"):
        return __lx_encode(v.tolist())
    raise TypeError("the return value has type " + type(v).__name__ + ", which can't be checked; return numbers, lists, arrays or tensors")

def __lx_load(source, driver=None):
    import linecache
    # Lets tracebacks show the student's source lines.
    linecache.cache["solution.py"] = (len(source), None, source.splitlines(True), "solution.py")
    ns = {"__name__": "solution"}
    exec(compile(source, "solution.py", "exec"), ns)
    if "torch" in __lx_sys.modules:
        __lx_torch()
    if driver is not None:
        # The item's test driver: builds the student's class and calls it.
        exec(compile(driver, "check.py", "exec"), ns)
    return ns
`;

const loadCall = (source: string, driver?: string) =>
  `__lx_load(__lx_b64.b64decode("${b64(source)}").decode("utf-8")${driver ? `, __lx_b64.b64decode("${b64(driver)}").decode("utf-8")` : ""})`;

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
export function buildJudgeProgram(fn: HarnessFunction, studentCode: string, driver?: string): string {
  return `${PRELUDE}${callBlock(fn)}
try:
    __lx_ns = ${loadCall(studentCode, driver)}
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
  driver?: string,
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
    __lx_ns = ${loadCall(code, driver)}
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

/* ── SQL ──────────────────────────────────────────────────────────────── */

export interface SqlHarness {
  tables: { name: string; columns: [string, string][] }[];
  /** false: rows are sorted before comparing, so any order is accepted. */
  ordered: boolean;
}

/** Most rows a query may return; practice answers are small. */
export const SQL_MAX_ROWS = 2000;

const SQL_PRELUDE = String.raw`
import base64 as __lx_b64, datetime as __lx_dt, decimal as __lx_dec, json as __lx_json, sys as __lx_sys
__lx_out = __lx_sys.stdout
__lx_sys.stdout = __lx_sys.stderr
import duckdb as __lx_duckdb

def __lx_cell(v):
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
    if isinstance(v, __lx_dec.Decimal):
        return int(v) if v == v.to_integral_value() else float(v)
    if isinstance(v, (__lx_dt.datetime, __lx_dt.date, __lx_dt.time)):
        return v.isoformat(sep=" ") if isinstance(v, __lx_dt.datetime) else v.isoformat()
    if isinstance(v, (list, tuple)):
        return [__lx_cell(x) for x in v]
    if isinstance(v, dict):
        return {str(k): __lx_cell(x) for k, x in v.items()}
    return str(v)

def __lx_key(row):
    # 24 and 24.0 (or 1e-9 apart) must sort the same, since they compare equal.
    def norm(v):
        if isinstance(v, float) and v == v and v not in (float("inf"), float("-inf")):
            r = round(v, 6)
            return int(r) if r == int(r) else r
        return v
    return __lx_json.dumps([norm(v) for v in row], default=str)

def __lx_query(tables, ordered, sql, data):
    con = __lx_duckdb.connect(":memory:")
    con.execute("SET threads=1")
    con.execute("SET memory_limit='256MB'")
    for t in tables:
        cols = ", ".join('"%s" %s' % (c[0], c[1]) for c in t["columns"])
        con.execute('CREATE TABLE "%s" (%s)' % (t["name"], cols))
        rows = data.get(t["name"]) or []
        if rows:
            marks = ", ".join("?" for _ in t["columns"])
            con.executemany('INSERT INTO "%s" VALUES (%s)' % (t["name"], marks), rows)
    statements = con.extract_statements(sql)
    if not statements:
        raise ValueError("write a query")
    if statements[-1].type != __lx_duckdb.StatementType.SELECT:
        raise ValueError("your SQL must end with a SELECT that returns the answer")
    cur = con.execute(sql)
    if cur.description is None:
        raise ValueError("your SQL must end with a SELECT that returns the answer")
    columns = [str(d[0]).lower() for d in cur.description]
    fetched = cur.fetchmany(${SQL_MAX_ROWS + 1})
    if len(fetched) > ${SQL_MAX_ROWS}:
        raise ValueError("your query returns more than ${SQL_MAX_ROWS} rows")
    rows = [[__lx_cell(v) for v in r] for r in fetched]
    if not ordered:
        rows.sort(key=__lx_key)
    return {"columns": columns, "data": rows}

def __lx_sql_error(exc):
    # DuckDB messages already say what's wrong and where; no Python traceback.
    return type(exc).__name__.replace("Exception", " error").strip() + ": " + str(exc)
`;

const sqlConfig = (h: SqlHarness) =>
  `__lx_tables = __lx_json.loads(__lx_b64.b64decode("${b64(JSON.stringify(h.tables))}").decode("utf-8"))\n__lx_ordered = ${h.ordered ? "True" : "False"}\n`;

/** One test per run: reads {"args": [tables]} from stdin, prints {"columns", "data"} as JSON. */
export function buildSqlJudgeProgram(h: SqlHarness, query: string): string {
  return `${SQL_PRELUDE}${sqlConfig(h)}
try:
    __lx_result = __lx_query(__lx_tables, __lx_ordered, __lx_b64.b64decode("${b64(query)}").decode("utf-8"), __lx_json.loads(__lx_sys.stdin.read())["args"][0])
except BaseException as __lx_e:
    if isinstance(__lx_e, SystemExit):
        raise
    __lx_sys.stderr.write(__lx_sql_error(__lx_e))
    __lx_sys.exit(1)
__lx_out.write(__lx_json.dumps(__lx_result, allow_nan=False))
`;
}

/** Content build only: runs one query on several datasets. Prints {"results": [{"ok", "value"|"error"}]}. */
export function buildSqlBatchProgram(h: SqlHarness, query: string, datasets: unknown[]): string {
  return `${SQL_PRELUDE}${sqlConfig(h)}
__lx_sql = __lx_b64.b64decode("${b64(query)}").decode("utf-8")
__lx_results = []
for __lx_data in __lx_json.loads(__lx_b64.b64decode("${b64(JSON.stringify(datasets))}").decode("utf-8")):
    try:
        __lx_results.append({"ok": True, "value": __lx_query(__lx_tables, __lx_ordered, __lx_sql, __lx_data)})
    except BaseException as __lx_e:
        __lx_results.append({"ok": False, "error": __lx_sql_error(__lx_e)})
__lx_out.write(__lx_json.dumps({"generated": [], "results": __lx_results}, allow_nan=False))
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
