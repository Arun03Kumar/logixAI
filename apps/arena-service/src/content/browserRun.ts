/**
 * Instant Run in the browser (production plan S3).
 *
 * Items the browser can run get a "runner kit": the item's real judge program
 * (the same harness the server judge runs) with a placeholder where the
 * learner's code goes, plus the sample tests and the comparison settings.
 * The web app runs it in Pyodide (Python + NumPy/Pandas/SciPy/DuckDB compiled
 * to WebAssembly, pinned to PYODIDE_VERSION), so a Run gives the same answer
 * as the judge without a server round trip. Submit always uses the server,
 * because hidden tests never leave it.
 *
 * An item runs in the browser only when both hold:
 *  - it's a candidate: SQL and plain Python items are; PyTorch / LangGraph
 *    items, dataset challenges and JavaScript items (their harness needs Node
 *    and jsdom) aren't;
 *  - it's verified: `npm run content:browser-check` ran its reference solution
 *    in Pyodide on every test and got the judge's answers, and recorded the
 *    item's hash in content/browser-run.generated.json. Some code legitimately
 *    differs in 32-bit WebAssembly (np.bincount on int64), so this is checked,
 *    not assumed. Editing the item changes its hash: it runs on the server
 *    until it's checked again.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { BrowserRunnerKit, RunIn } from "@logixai/contracts";
import { isJudged, type CatalogItem } from "./catalog.js";
import { buildJudgeProgram, buildSqlJudgeProgram } from "./harness.js";

/** Pinned: its packages (numpy 2.0, pandas 2.2, scipy 1.14, duckdb 1.1) match the judge image closely. */
export const PYODIDE_VERSION = "0.27.7";

/** Packages Pyodide doesn't have (or that are far too big to download per learner). */
const SERVER_ONLY_IMPORT = /^\s*(?:import|from)\s+(?:torch|torchvision|langgraph|langchain\w*|transformers|tensorflow|keras)\b/m;
const SERVER_ONLY_PARAMS = new Set(["tensor", "tensor_int"]);

/** Base64 of this marks where the learner's code goes in the program. */
const SENTINEL = "__LX_LEARNER_CODE__";
export const CODE_PLACEHOLDER = Buffer.from(SENTINEL, "utf8").toString("base64");

/**
 * Per-test time limit in the browser: the server's Python limit (2 s × 3),
 * doubled because WebAssembly is slower than native code.
 */
export const BROWSER_TEST_TIME_LIMIT_MS = 12_000;

/** Could this item run in the browser? (It still has to be verified.) */
export function browserCandidate(item: CatalogItem): boolean {
  if (!isJudged(item) || !item.judge) return false;
  if (item.type === "sql") return true;
  if (item.language === "javascript") return false;
  if (item.dataset || item.scoring) return false;
  if (item.function.params.some((p) => SERVER_ONLY_PARAMS.has(p.type))) return false;
  const code = [item.solution, item.starter, item.driver ?? ""].join("\n");
  return !SERVER_ONLY_IMPORT.test(code);
}

/** Where Run executes for a judged item (undefined for other item types). */
export function runIn(item: CatalogItem): RunIn | undefined {
  if (!isJudged(item) || !item.judge) return undefined;
  return browserCandidate(item) && item.browserVerified ? "browser" : "server";
}

/* ── Verification record (written by content:browser-check) ── */

export const BROWSER_RUN_FILE = "browser-run.generated.json";

export interface BrowserRunRecord {
  pyodideVersion: string;
  /** item id -> browserRunHash of the version that matched the judge. */
  items: Record<string, string>;
}

/** Everything the browser result depends on: Pyodide, the program (harness + driver), the reference solution and the tests. */
export function browserRunHash(item: CatalogItem): string {
  const kit = buildKit(item, []);
  const basis = JSON.stringify([PYODIDE_VERSION, kit?.program ?? null, "solution" in item ? item.solution : null, item.judge ?? null]);
  return createHash("sha256").update(basis).digest("hex").slice(0, 16);
}

export function readBrowserRunRecord(dir: string): BrowserRunRecord {
  const p = path.join(dir, BROWSER_RUN_FILE);
  if (!existsSync(p)) return { pyodideVersion: PYODIDE_VERSION, items: {} };
  const record = JSON.parse(readFileSync(p, "utf8")) as BrowserRunRecord;
  // Another Pyodide version means nothing is verified for this one.
  return record.pyodideVersion === PYODIDE_VERSION ? record : { pyodideVersion: PYODIDE_VERSION, items: {} };
}

/** Sets item.browserVerified on candidates whose current version matched the judge. */
export function applyBrowserRunRecord(items: readonly CatalogItem[], record: BrowserRunRecord): void {
  for (const item of items) {
    item.browserVerified = browserCandidate(item) && record.items[item.id] === browserRunHash(item);
  }
}

/** The program and sample tests for running `item` in the browser, or undefined if it must run on the server. */
export function browserRunnerKit(
  item: CatalogItem,
  sample: { call: string; expected: string }[],
): BrowserRunnerKit | undefined {
  return runIn(item) === "browser" ? buildKit(item, sample) : undefined;
}

/** The kit for any candidate, verified or not (content:browser-check uses it to verify). */
export function buildKit(item: CatalogItem, sample: { call: string; expected: string }[]): BrowserRunnerKit | undefined {
  if (!browserCandidate(item) || !isJudged(item) || !item.judge) return undefined;
  const program =
    item.type === "sql"
      ? buildSqlJudgeProgram({ tables: item.tables, ordered: item.ordered }, SENTINEL)
      : buildJudgeProgram(item.function, SENTINEL, item.driver);
  // The learner's code must be substituted in exactly one place.
  if (program.split(CODE_PLACEHOLDER).length !== 2) return undefined;
  return {
    itemId: item.id,
    engine: "pyodide",
    pyodideVersion: PYODIDE_VERSION,
    codeLanguage: item.type === "sql" ? "sql" : "python",
    program,
    placeholder: CODE_PLACEHOLDER,
    tests: item.judge.sample.map((t, i) => ({
      input: JSON.stringify({ args: t.args }),
      expected: t.expected,
      call: sample[i]?.call ?? "",
      expectedText: sample[i]?.expected ?? t.expected,
    })),
    tolerance: { absTol: item.tolerance.abs, relTol: item.tolerance.rel },
    timeLimitMs: BROWSER_TEST_TIME_LIMIT_MS,
  };
}
