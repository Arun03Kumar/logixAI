/**
 * npm run content:build [-- --check]
 *
 * Validates ML Arena content and writes content/tests.generated.json:
 *  - code/debug items: runs the reference solution on every test (plus
 *    generated ones) in the judge image, records the expected outputs, checks
 *    any hand-written `expected`, and checks the starter FAILS at least one
 *    test (otherwise the item is solved before the student starts);
 *  - output items: runs the snippet and checks `answer` is exactly what it prints.
 *
 * --check: don't write; exit 1 if the file is out of date (for CI).
 * Needs Docker and the image from `npm run judge:images`.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { jsonValuesMatch } from "@logixai/contracts";
import { GENERATED_FILE, codeItemHash, isCode, readSources } from "../src/content/catalog.js";
import { buildBatchProgram, seedFor } from "../src/content/harness.js";
import type { CodeItemSource, GeneratedTests, ItemSource } from "../src/content/schema.js";
import { runPython } from "./docker-python.js";

const CONTENT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "content");
const check = process.argv.includes("--check");
const PARALLEL = 4;

type BatchOutput = { generated: unknown[][]; results: ({ ok: true; value: unknown } | { ok: false; error: string })[] };

async function batch(item: CodeItemSource, code: string, cases: unknown[][], withGenerator: boolean) {
  const program = buildBatchProgram(
    item.function,
    code,
    cases,
    withGenerator && item.tests.generate ? { source: item.tests.generate, seed: seedFor(item.id) } : undefined,
  );
  const run = await runPython(program);
  if (run.exitCode !== 0) throw new Error(`harness crashed (exit ${run.exitCode}): ${run.stderr.slice(-800)}`);
  return JSON.parse(run.stdout) as BatchOutput;
}

const normalizeLines = (text: string) =>
  text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.trimEnd())
    .join("\n")
    .replace(/\n+$/, "");

async function buildCodeItem(item: CodeItemSource): Promise<GeneratedTests["items"][string]> {
  const tol = { absTol: item.tolerance.abs, relTol: item.tolerance.rel };
  const explicit = [...item.tests.sample, ...item.tests.hidden];
  const ref = await batch(item, item.solution, explicit.map((t) => t.args), true);
  const allArgs = [...explicit.map((t) => t.args), ...ref.generated];

  const encoded = ref.results.map((r, i) => {
    if (!r.ok) throw new Error(`reference solution fails test ${i + 1}:\n${r.error}`);
    const given = explicit[i]?.expected;
    if (given !== undefined && !jsonValuesMatch(given, r.value, tol)) {
      throw new Error(
        `test ${i + 1}: reference returned ${JSON.stringify(r.value)} but the test expects ${JSON.stringify(given)}`,
      );
    }
    return JSON.stringify(r.value);
  });

  const starter = await batch(item, item.starter, allArgs, false);
  const starterPasses = starter.results.every(
    (r, i) => r.ok && jsonValuesMatch(JSON.parse(encoded[i]!), r.value, tol),
  );
  if (starterPasses) throw new Error("the starter code already passes every test");

  const nSample = item.tests.sample.length;
  return {
    hash: codeItemHash(item),
    sample: allArgs.slice(0, nSample).map((args, i) => ({ args, expected: encoded[i]! })),
    hidden: allArgs.slice(nSample).map((args, i) => ({ args, expected: encoded[nSample + i]! })),
  };
}

async function checkOutputItem(item: Extract<ItemSource, { type: "output" }>) {
  const run = await runPython(item.snippet);
  const printed = normalizeLines(run.stdout);
  if (run.exitCode !== 0) throw new Error(`snippet fails:\n${run.stderr.slice(-800)}`);
  if (printed !== normalizeLines(item.answer)) {
    throw new Error(`snippet prints ${JSON.stringify(printed)} but answer is ${JSON.stringify(normalizeLines(item.answer))}`);
  }
}

async function main() {
  const sources = readSources(CONTENT_DIR);
  const items = [...sources.topics.values()].flatMap((t) => t.items);
  const generated: GeneratedTests = { items: {} };
  const failures: string[] = [];
  const queue = [...items];

  const worker = async () => {
    for (let item = queue.shift(); item; item = queue.shift()) {
      try {
        if (isCode(item)) generated.items[item.id] = await buildCodeItem(item);
        else if (item.type === "output") await checkOutputItem(item);
        else continue;
        console.log(`ok    ${item.id}`);
      } catch (err) {
        failures.push(`${item.id}: ${(err as Error).message}`);
        console.log(`FAIL  ${item.id}`);
      }
    }
  };
  await Promise.all(Array.from({ length: PARALLEL }, worker));

  if (failures.length) {
    console.error(`\n${failures.length} item(s) failed:\n\n${failures.join("\n\n")}`);
    process.exit(1);
  }

  // Stable output: items sorted by id.
  const sorted: GeneratedTests = {
    items: Object.fromEntries(Object.entries(generated.items).sort(([a], [b]) => a.localeCompare(b))),
  };
  // One test per line: readable diffs without a line per number.
  const tests = (list: { args: unknown[]; expected: string }[]) =>
    list.length ? `[\n${list.map((t) => `    ${JSON.stringify(t)}`).join(",\n")}\n   ]` : "[]";
  const entries = Object.entries(sorted.items).map(
    ([id, v]) =>
      `  ${JSON.stringify(id)}: {\n   "hash": ${JSON.stringify(v.hash)},\n   "sample": ${tests(v.sample)},\n   "hidden": ${tests(v.hidden)}\n  }`,
  );
  const text = `{\n "items": {\n${entries.join(",\n")}\n }\n}\n`;
  const file = path.join(CONTENT_DIR, GENERATED_FILE);
  if (check) {
    const current = existsSync(file) ? readFileSync(file, "utf8").replace(/\r\n/g, "\n") : "";
    if (current !== text) {
      console.error(`${GENERATED_FILE} is out of date. Run npm run content:build.`);
      process.exit(1);
    }
    console.log(`\n${items.length} items checked; ${GENERATED_FILE} is up to date.`);
    return;
  }
  writeFileSync(file, text);
  console.log(`\n${items.length} items checked; wrote ${Object.keys(sorted.items).length} code items to ${GENERATED_FILE}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
