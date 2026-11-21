"use client";
import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import toast from "react-hot-toast";
import { ArrowRight, CheckCircle2, Database, Eye, Lightbulb, ListChecks, Play, RotateCcw, Send, XCircle } from "lucide-react";
import { Button, Spinner, VerdictBadge, cn } from "@logixai/ui";
import MathMarkdown from "@/app/components/MathMarkdown";
import { configureJsx, editorOptions, handleEditorMount } from "@/app/coding-platform/components/problem/editorConfig";
import { arenaApi } from "@/app/lib/api/arena";
import DataTable, { TableDiff, isTableValue, parseJson } from "../../_components/DataTable";
import LivePreview from "../../_components/LivePreview";
import SimChart from "../../_components/SimChart";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
  loading: () => (
    <div className="grid h-full place-items-center bg-[#1e1e1e]">
      <Spinner />
    </div>
  ),
});

const POLL_MS = 1000;
const POLL_LIMIT = 90;

const draftKey = (id) => `arena-draft:${id}`;
function readDraft(id) {
  try {
    return window.localStorage.getItem(draftKey(id));
  } catch {
    return null;
  }
}
function writeDraft(id, code) {
  try {
    window.localStorage.setItem(draftKey(id), code);
  } catch {
    // Private mode or storage full: the server still keeps the last run.
  }
}

/**
 * JSON values for display: floats rounded to 6 significant digits, so
 * 1.9999999999999982 shows as 2. Grading uses the exact values (with tolerance).
 */
function pretty(json) {
  if (json == null || json === "") return json;
  let value;
  try {
    value = JSON.parse(json);
  } catch {
    return json;
  }
  const fmt = (v) => {
    if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(Number(v.toPrecision(6)));
    if (Array.isArray(v)) return `[${v.map(fmt).join(", ")}]`;
    if (v && typeof v === "object") return `{${Object.entries(v).map(([k, x]) => `${JSON.stringify(k)}: ${fmt(x)}`).join(", ")}}`;
    return JSON.stringify(v);
  };
  return fmt(value);
}

function signatureLine(sig, js) {
  if (js) return `function ${sig.name}(${sig.params.map((p) => p.name).join(", ")})  // returns ${sig.returns}`;
  return `def ${sig.name}(${sig.params.map((p) => `${p.name}: ${p.type}`).join(", ")}) -> ${sig.returns}`;
}

function editorLabel(item, sql, js) {
  if (sql) return "SQL · DuckDB";
  if (js) return item.preview || item.driver?.includes("__lx.render") ? "React 19 · JSX" : "JavaScript · Node 22";
  return "Python 3 · NumPy · Pandas · PyTorch";
}

/** A judge value: a table when it's one ({columns, data}), otherwise compact JSON. */
function ValueView({ json, caption }) {
  const value = parseJson(json);
  if (isTableValue(value)) return <DataTable caption={caption} columns={value.columns} rows={value.data} />;
  return (
    <p className="break-all font-mono text-xs">
      {caption ? <span className="text-muted-foreground">{caption}: </span> : null}
      {pretty(json) || "(nothing)"}
    </p>
  );
}

/** Expected vs returned for a failed example: a table diff for tables, two lines otherwise. */
function Mismatch({ expected, output }) {
  const e = parseJson(expected);
  const a = parseJson(output);
  if (isTableValue(e) && isTableValue(a)) return <TableDiff expected={e} actual={a} />;
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono text-xs">
      <dt className="text-muted-foreground">Expected</dt>
      <dd className="break-all">{pretty(expected)}</dd>
      <dt className="text-muted-foreground">Returned</dt>
      <dd className="break-all">{pretty(output) || "(nothing)"}</dd>
    </dl>
  );
}

function Results({ submission, running, sql, visual }) {
  if (running && !submission) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner className="size-3.5" /> Sending your code to the judge…
      </p>
    );
  }
  if (!submission) {
    return (
      <p className="text-sm text-muted-foreground">
        {sql
          ? "Run your query to see its result on the sample data, then submit it."
          : "Run your code to check it against the examples, then submit it."}
      </p>
    );
  }
  if (submission.status === "pending") {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner className="size-3.5" /> Running {submission.total} {submission.total === 1 ? "test" : "tests"}…
      </p>
    );
  }
  const passedAll = submission.status === "passed";
  return (
    <div className="space-y-3">
      <p className={cn("flex flex-wrap items-center gap-2 text-sm font-semibold", passedAll ? "text-success" : "text-danger")}>
        {passedAll ? <CheckCircle2 className="size-4" /> : <XCircle className="size-4" />}
        {submission.status === "error"
          ? "The judge couldn't run your code."
          : `${submission.passed} of ${submission.total} tests passed`}
        {submission.mode === "submit" && passedAll ? <span className="font-normal">· Accepted</span> : null}
        {submission.xpGained ? <span className="font-normal">· +{submission.xpGained} XP</span> : null}
      </p>
      <ul className="space-y-2">
        {submission.tests.map((t) =>
          t.sample ? (
            <li key={t.index} className="space-y-1.5 rounded-md border border-border p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">Example {t.index + 1}</span>
                <VerdictBadge status={t.verdict} />
              </div>
              {t.call && !sql ? <p className="break-all font-mono text-xs text-muted-foreground">{t.call}</p> : null}
              {t.verdict === "WA" ? <Mismatch expected={t.expected} output={t.output} /> : null}
              {visual && t.verdict === "WA" ? (
                <div className="grid gap-3 pt-1 xl:grid-cols-2">
                  <SimChart visual={visual} json={t.expected} caption="Expected" />
                  <SimChart visual={visual} json={t.output} caption="Yours" />
                </div>
              ) : null}
              {visual && t.verdict === "SUCCESS" && t.output ? <SimChart visual={visual} json={t.output} caption="Yours" /> : null}
              {t.verdict === "SUCCESS" && sql && t.output ? <ValueView json={t.output} caption="Your result" /> : null}
              {t.message ? (
                <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 font-mono text-xs">{t.message}</pre>
              ) : null}
            </li>
          ) : (
            <li key={t.index} className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm">
              <span>{sql ? "Hidden dataset" : "Hidden test"} {t.index + 1}</span>
              <VerdictBadge status={t.verdict} />
            </li>
          ),
        )}
      </ul>
    </div>
  );
}

/** Code and debug items: an editor, Run (examples) and Submit (all tests). */
/** First rows of a dataset challenge's data, so learners can see what they're modelling. */
function DatasetPreview({ dataset, scoring }) {
  const cell = (v) => (v === null || v === undefined ? "—" : String(v));
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold">Data</h2>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-xs">
          <thead className="bg-muted">
            <tr>
              {dataset.columns.map((c) => (
                <th key={c} className={cn("px-2 py-1.5 text-left font-medium", c === dataset.target && "text-primary")}>
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {dataset.rows.map((row, i) => (
              <tr key={i} className="border-t border-border">
                {row.map((v, j) => (
                  <td key={j} className="whitespace-nowrap px-2 py-1 font-mono tabular-nums">
                    {cell(v)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        {dataset.rowCount} rows; you train on {dataset.trainRows} and predict {dataset.testRows} held-out rows whose{" "}
        <span className="font-medium text-primary">{dataset.target}</span> you never see. Missing values show as —.
        {scoring ? ` Pass mark: ${scoring.metric} ${scoring.metric === "rmse" || scoring.metric === "mae" ? "≤" : "≥"} ${scoring.threshold}.` : ""}
      </p>
    </section>
  );
}

/** SQL items: the tables and their column types. */
function SchemaPanel({ tables }) {
  return (
    <section className="space-y-2">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <Database className="size-4" />
        Tables
      </h2>
      <div className="grid gap-2 sm:grid-cols-2">
        {tables.map((t) => (
          <div key={t.name} className="rounded-lg border border-border bg-card px-3 py-2">
            <p className="font-mono text-sm font-semibold">{t.name}</p>
            <ul className="mt-1 space-y-0.5 font-mono text-xs">
              {t.columns.map(([name, type]) => (
                <li key={name} className="flex justify-between gap-3">
                  <span>{name}</span>
                  <span className="text-muted-foreground">{type}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

/** One example: its input tables (SQL data, DataFrame arguments) and the expected answer. */
function Example({ sample, sql, visual }) {
  const [open, setOpen] = useState(() => (sample.tables ?? []).filter((t) => t.rows.length).slice(0, 2).map((t) => t.name));
  const toggle = (name) => setOpen((o) => (o.includes(name) ? o.filter((n) => n !== name) : [...o, name]));
  return (
    <li className="space-y-2 rounded-lg border border-border bg-card px-3 py-2">
      {!sql ? <p className="break-all font-mono text-xs">{sample.call}</p> : null}
      {sample.tables?.length ? (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Input tables">
            {sample.tables.map((t) => (
              <button
                key={t.name}
                type="button"
                onClick={() => toggle(t.name)}
                aria-pressed={open.includes(t.name)}
                className={cn(
                  "rounded-md border px-2 py-0.5 font-mono text-xs transition-colors",
                  open.includes(t.name) ? "border-primary bg-primary-soft text-primary-soft-foreground" : "border-border text-muted-foreground hover:text-foreground",
                )}
              >
                {t.name} · {t.rows.length}
              </button>
            ))}
          </div>
          {sample.tables
            .filter((t) => open.includes(t.name))
            .map((t) => (
              <DataTable key={t.name} caption={t.name} columns={t.columns} rows={t.rows} />
            ))}
        </div>
      ) : null}
      <ValueView json={sample.expected} caption={sql ? "Expected result" : "→"} />
      {visual ? <SimChart visual={visual} json={sample.expected} /> : null}
    </li>
  );
}

export default function CodePlayer({ item, signedIn, onItemChange, reviewMode = false, inSession = false }) {
  const sql = item.type === "sql";
  const js = item.language === "javascript";
  const [pane, setPane] = useState(item.preview ? "preview" : "results");
  // A review starts from scratch: recall it, don't reload it.
  const [code, setCode] = useState(() =>
    reviewMode ? (item.starterCode ?? "") : (readDraft(item.id) ?? item.lastAnswer?.code ?? item.starterCode ?? ""),
  );
  const [passedNow, setPassedNow] = useState(false);
  const [submission, setSubmission] = useState(null);
  const [running, setRunning] = useState(false);
  const [hints, setHints] = useState(0);
  const alive = useRef(true);
  const open = (item.status === "solved" || item.status === "revealed") && (!reviewMode || passedNow);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const change = (value) => {
    setCode(value ?? "");
    writeDraft(item.id, value ?? "");
  };

  const poll = async (id) => {
    for (let i = 0; i < POLL_LIMIT && alive.current; i++) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      const s = await arenaApi.submission(id);
      if (!alive.current) return null;
      setSubmission(s);
      if (s.status !== "pending") return s;
    }
    return null;
  };

  const run = async (mode) => {
    setRunning(true);
    setPane("results");
    setSubmission(null);
    try {
      const created = await arenaApi.runCode(item.id, code, mode);
      setSubmission(created);
      const done = await poll(created.id);
      if (!done) {
        if (alive.current) toast("Still judging — check back in a moment.");
      } else if (done.mode === "submit" && done.status === "passed") {
        toast.success(done.xpGained ? `Accepted! +${done.xpGained} XP` : reviewMode ? "Reviewed — see you at the next interval." : "Accepted!");
        setPassedNow(true);
        onItemChange(await arenaApi.item(item.id));
      }
    } catch (err) {
      toast.error(err.message);
    } finally {
      if (alive.current) setRunning(false);
    }
  };

  const reset = () => {
    if (!window.confirm("Replace your code with the starting code?")) return;
    change(item.starterCode ?? "");
  };

  const reveal = async () => {
    if (!window.confirm("Show the solution? You won't earn XP for this item, but you can still submit it.")) return;
    try {
      onItemChange(await arenaApi.reveal(item.id));
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <div className="grid gap-4 lg:h-[calc(100vh-11rem)] lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      {/* Problem */}
      <div className="space-y-5 lg:overflow-y-auto lg:pr-2">
        <MathMarkdown>{item.prompt}</MathMarkdown>

        {sql ? (
          <SchemaPanel tables={item.sqlTables} />
        ) : item.driver ? (
          <section className="space-y-2">
            <h2 className="text-sm font-semibold">How your code is tested</h2>
            <p className="text-xs text-muted-foreground">
              This runs after your code. Each example calls <code className="font-mono">{item.signature?.name}(...)</code>, which builds and
              uses what you wrote.
            </p>
            <pre className="max-h-72 overflow-auto rounded-lg border border-border bg-muted px-3 py-2 font-mono text-xs">
              {item.driver.trimEnd()}
            </pre>
          </section>
        ) : (
          <section className="space-y-2">
            <h2 className="text-sm font-semibold">Function</h2>
            <pre className="overflow-x-auto rounded-lg border border-border bg-muted px-3 py-2 font-mono text-xs">
              {signatureLine(item.signature, js)}
            </pre>
          </section>
        )}

        {item.dataset ? <DatasetPreview dataset={item.dataset} scoring={item.scoring} /> : null}

        <section className="space-y-2">
          <h2 className="text-sm font-semibold">{sql ? "Sample data" : "Examples"}</h2>
          <ul className="space-y-2">
            {item.samples.map((s, i) => (
              <Example key={i} sample={s} sql={sql} visual={item.visual} />
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            {sql
              ? `Submit also runs your query on ${item.hiddenTestCount} hidden ${item.hiddenTestCount === 1 ? "dataset" : "datasets"} with more rows, ties and NULLs. Column names must match (any case); ${item.ordered ? "row order matters" : "rows can come back in any order"}. The database is DuckDB, close to PostgreSQL.`
              : item.scoring
              ? "Run trains on part of the training rows and scores your predictions on a validation split. Submit trains on all of them and scores the held-out rows."
              : js
              ? `Submit also runs ${item.hiddenTestCount} hidden ${item.hiddenTestCount === 1 ? "test" : "tests"}. ${editorLabel(item, sql, js).startsWith("React") ? "Components render in a simulated DOM (jsdom); timers run on a fake clock." : item.visual ? "Each test replays simulated traffic; the chart shows what your code decided." : "Timers run on a fake clock, so timing is exact and instant."}`
              : `Submit also runs ${item.hiddenTestCount} hidden ${item.hiddenTestCount === 1 ? "test" : "tests"}. Numbers are compared with a small tolerance; NumPy arrays, tensors, lists and DataFrames all work as return values.`}
          </p>
        </section>

        {item.hints.length ? (
          <section className="space-y-2">
            {item.hints.slice(0, hints).map((hint, i) => (
              <div key={i} className="flex gap-3 rounded-lg bg-info-soft px-4 py-3 text-sm">
                <Lightbulb className="mt-0.5 size-4 shrink-0 text-info" />
                <MathMarkdown inline>{hint}</MathMarkdown>
              </div>
            ))}
            {item.hints.length > hints ? (
              <Button variant="ghost" size="sm" onClick={() => setHints((h) => h + 1)}>
                <Lightbulb />
                {hints ? "Another hint" : "Show a hint"}
              </Button>
            ) : null}
          </section>
        ) : null}

        {open ? (
          <section className="space-y-3 rounded-lg border border-success p-4">
            <p className="flex items-center gap-2 font-semibold text-success">
              <CheckCircle2 className="size-4" />
              {item.status === "solved" ? "Solved — reference solution" : "Reference solution"}
            </p>
            <pre className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs">{item.solution}</pre>
            <MathMarkdown>{item.explanation}</MathMarkdown>
            {item.nextItem ? (
              <Button asChild size="sm">
                <Link href={`/arena/items/${item.nextItem.id}`}>
                  Next: {item.nextItem.title}
                  <ArrowRight />
                </Link>
              </Button>
            ) : null}
          </section>
        ) : signedIn && !reviewMode && !inSession ? (
          <Button variant="ghost" size="sm" onClick={reveal}>
            Show solution
          </Button>
        ) : null}
      </div>

      {/* Editor + results */}
      <div className="flex min-h-[560px] flex-col overflow-hidden rounded-lg border border-border lg:min-h-0">
        <div className="flex items-center gap-2 border-b border-border bg-card px-3 py-2">
          <span className="text-sm font-medium">{editorLabel(item, sql, js)}</span>
          <Button variant="ghost" size="sm" onClick={reset} className="ml-auto" aria-label="Reset to starting code">
            <RotateCcw />
          </Button>
          {signedIn ? (
            <>
              <Button size="sm" onClick={() => run("run")} disabled={running}>
                <Play />
                Run
              </Button>
              <Button variant="primary" size="sm" onClick={() => run("submit")} disabled={running}>
                <Send />
                Submit
              </Button>
            </>
          ) : (
            <Button asChild variant="primary" size="sm">
              <Link href={`/login?next=/arena/items/${item.id}`}>Sign in to run code</Link>
            </Button>
          )}
        </div>
        <div className="min-h-[300px] flex-1 bg-[#1e1e1e]">
          <MonacoEditor
            height="100%"
            path={`arena-${item.id}.${sql ? "sql" : js ? "jsx" : "py"}`}
            language={sql ? "sql" : js ? "javascript" : "python"}
            beforeMount={js ? configureJsx : undefined}
            theme="vs-dark"
            value={code}
            onChange={change}
            onMount={handleEditorMount}
            options={editorOptions(js ? { tabSize: 2 } : {})}
          />
        </div>
        {item.preview ? (
          <div className="flex items-center gap-1 border-t border-border bg-card px-2 pt-1.5" role="tablist" aria-label="Output">
            {[
              ["preview", "Live preview", Eye],
              ["results", "Test results", ListChecks],
            ].map(([key, label, Icon]) => (
              <button
                key={key}
                role="tab"
                aria-selected={pane === key}
                onClick={() => setPane(key)}
                className={cn(
                  "flex items-center gap-1.5 rounded-t-md border-b-2 px-3 py-1.5 text-xs font-medium",
                  pane === key ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="size-3.5" />
                {label}
              </button>
            ))}
          </div>
        ) : null}
        {item.preview ? (
          <LivePreview
            code={code}
            component={item.preview.component}
            props={item.preview.props}
            className={cn("h-[45%] border-t border-border", pane !== "preview" && "hidden")}
          />
        ) : null}
        <div
          className={cn(
            "max-h-[40%] min-h-[96px] overflow-y-auto border-t border-border bg-card p-4",
            item.preview && pane !== "results" && "hidden",
          )}
          aria-live="polite"
        >
          <Results submission={submission} running={running} sql={sql} visual={item.visual} />
        </div>
      </div>
    </div>
  );
}
