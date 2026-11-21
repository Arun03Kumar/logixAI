/**
 * `npm run content:browser-check`: proves that Run in the browser gives the
 * judge's answers.
 *
 * For every item that runs in the browser, runs its reference solution in
 * Pyodide (the pinned version learners download) on ALL its tests, sample and
 * hidden, using the same test runner as the browser
 * (apps/web/public/arena-runner/core.js), and compares the output with the
 * expected value the judge produced (tests.generated.json).
 *
 * Pyodide and the packages are downloaded once into .cache/pyodide/<version>
 * (git-ignored). Items that match on every test are recorded with their hash
 * in content/browser-run.generated.json; only those run in the browser.
 * Usage: npm run content:browser-check [-- item-id ...] (re-checks just those)
 * Add --strict to fail when any candidate differs.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import vm from "node:vm";
import { jsonOutputsMatch } from "@logixai/contracts";
import { loadCatalog } from "../src/content/catalog.js";
import {
  BROWSER_RUN_FILE,
  CODE_PLACEHOLDER,
  PYODIDE_VERSION,
  browserRunHash,
  buildKit,
  readBrowserRunRecord,
} from "../src/content/browserRun.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = path.join(ROOT, ".cache", "pyodide", PYODIDE_VERSION);
const CDN = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;
const CORE_FILES = ["pyodide.mjs", "pyodide.asm.js", "pyodide.asm.wasm", "python_stdlib.zip", "pyodide-lock.json"];

interface LockPackage {
  file_name: string;
  sha256: string;
  depends: string[];
  imports: string[];
}

async function download(name: string, sha256?: string) {
  const target = path.join(CACHE, name);
  if (existsSync(target)) return;
  const res = await fetch(CDN + name);
  if (!res.ok) throw new Error(`download ${name}: HTTP ${res.status}`);
  const body = Buffer.from(await res.arrayBuffer());
  if (sha256 && createHash("sha256").update(body).digest("hex") !== sha256) throw new Error(`download ${name}: checksum mismatch`);
  writeFileSync(target, body);
}

async function main() {
  const only = new Set(process.argv.slice(2).filter((a) => !a.startsWith("-")));
  mkdirSync(CACHE, { recursive: true });
  for (const f of CORE_FILES) await download(f);
  const lock = JSON.parse(readFileSync(path.join(CACHE, "pyodide-lock.json"), "utf8")) as {
    packages: Record<string, LockPackage>;
  };
  const byImport = new Map<string, string>();
  for (const [name, p] of Object.entries(lock.packages)) for (const imp of p.imports) byImport.set(imp, name);

  /** Downloads a package and its dependencies (wheels are checksum-verified). */
  const fetched = new Set<string>();
  async function ensurePackage(name: string): Promise<void> {
    if (fetched.has(name)) return;
    fetched.add(name);
    const p = lock.packages[name];
    if (!p) return;
    for (const dep of p.depends) await ensurePackage(dep);
    await download(p.file_name, p.sha256);
  }

  // Pyodide's Node loader expects CommonJS globals; this script is an ES module.
  Object.assign(globalThis, { require: createRequire(path.join(CACHE, "pyodide.mjs")), __dirname: CACHE });
  const { loadPyodide } = (await import(pathToFileURL(path.join(CACHE, "pyodide.mjs")).href)) as {
    loadPyodide: (o: { indexURL: string }) => Promise<any>;
  };
  const pyodide = await loadPyodide({ indexURL: CACHE + path.sep });
  const findImports = pyodide.pyimport("pyodide.code").find_imports;
  // The exact runner the browser uses.
  const corePath = path.resolve(ROOT, "..", "web", "public", "arena-runner", "core.js");
  vm.runInThisContext(readFileSync(corePath, "utf8"), { filename: corePath });
  const runner = (globalThis as unknown as { LogixPyRunner: { prepare: Function; runOne: Function } }).LogixPyRunner;

  const contentDir = path.join(ROOT, "content");
  const catalog = loadCatalog(contentDir);
  let items = 0;
  let tests = 0;
  const failures: string[] = [];
  const started = Date.now();

  // Re-checking a few items keeps the other entries; a full run starts over.
  const record = only.size ? readBrowserRunRecord(contentDir) : { pyodideVersion: PYODIDE_VERSION, items: {} as Record<string, string> };

  for (const item of catalog.items) {
    if (only.size && !only.has(item.id)) continue;
    const kit = buildKit(item, []);
    if (!kit || !item.judge || !("solution" in item)) continue;
    items++;
    const program = kit.program.replace(CODE_PLACEHOLDER, Buffer.from(item.solution, "utf8").toString("base64"));

    // Packages the program and (Python items) the solution import, scanned separately.
    const sources = kit.codeLanguage === "python" ? [program, item.solution] : [program];
    for (const source of sources) {
      for (const imp of findImports(source).toJs() as string[]) {
        const pkg = byImport.get(imp.split(".")[0]!);
        if (pkg) await ensurePackage(pkg);
      }
    }
    await runner.prepare(pyodide, sources);

    const before = failures.length;
    for (const [i, t] of [...item.judge.sample, ...item.judge.hidden].entries()) {
      tests++;
      const r = await runner.runOne(pyodide, program, JSON.stringify({ args: t.args }));
      if (!r.exitOk) {
        failures.push(`${item.id} test ${i + 1}: error\n${r.stderr.trim().split("\n").slice(-4).join("\n")}`);
      } else if (!jsonOutputsMatch(t.expected, r.stdout, kit.tolerance)) {
        failures.push(`${item.id} test ${i + 1}: expected ${t.expected.slice(0, 160)}\n  browser gave ${r.stdout.trim().slice(0, 160)}`);
      }
    }
    const matched = failures.length === before;
    if (matched) record.items[item.id] = browserRunHash(item);
    else delete record.items[item.id];
    process.stdout.write(matched ? "." : "x");
  }

  const sorted = Object.fromEntries(Object.entries(record.items).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(
    path.join(contentDir, BROWSER_RUN_FILE),
    `${JSON.stringify({ pyodideVersion: PYODIDE_VERSION, items: sorted }, null, 2)}\n`,
  );

  console.log(`\n${items} items, ${tests} tests in Pyodide ${PYODIDE_VERSION} (${Math.round((Date.now() - started) / 1000)} s).`);
  console.log(`${Object.keys(sorted).length} items verified for the browser (content/${BROWSER_RUN_FILE}).`);
  if (failures.length) {
    // Not an error: those items simply keep running on the server.
    console.log(`\n${failures.length} test(s) differ from the judge, so their items run on the server:\n\n${failures.join("\n\n")}`);
    if (process.argv.includes("--strict")) process.exit(1);
    return;
  }
  console.log("Every candidate matches the judge.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
