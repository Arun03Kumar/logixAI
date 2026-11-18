"use client";
import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import toast from "react-hot-toast";
import { ArrowRight, CheckCircle2, Lightbulb, Play, RotateCcw, Send, XCircle } from "lucide-react";
import { Button, Spinner, VerdictBadge, cn } from "@logixai/ui";
import MathMarkdown from "@/app/components/MathMarkdown";
import { editorOptions, handleEditorMount } from "@/app/coding-platform/components/problem/editorConfig";
import { arenaApi } from "@/app/lib/api/arena";

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

function signatureLine(sig) {
  return `def ${sig.name}(${sig.params.map((p) => `${p.name}: ${p.type}`).join(", ")}) -> ${sig.returns}`;
}

function Results({ submission, running }) {
  if (running && !submission) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner className="size-3.5" /> Sending your code to the judge…
      </p>
    );
  }
  if (!submission) {
    return <p className="text-sm text-muted-foreground">Run your code to check it against the examples, then submit it.</p>;
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
              {t.call ? <p className="break-all font-mono text-xs text-muted-foreground">{t.call}</p> : null}
              {t.verdict === "WA" ? (
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono text-xs">
                  <dt className="text-muted-foreground">Expected</dt>
                  <dd className="break-all">{pretty(t.expected)}</dd>
                  <dt className="text-muted-foreground">Returned</dt>
                  <dd className="break-all">{pretty(t.output) || "(nothing)"}</dd>
                </dl>
              ) : null}
              {t.message ? (
                <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 font-mono text-xs">{t.message}</pre>
              ) : null}
            </li>
          ) : (
            <li key={t.index} className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm">
              <span>Hidden test {t.index + 1}</span>
              <VerdictBadge status={t.verdict} />
            </li>
          ),
        )}
      </ul>
    </div>
  );
}

/** Code and debug items: an editor, Run (examples) and Submit (all tests). */
export default function CodePlayer({ item, signedIn, onItemChange }) {
  const [code, setCode] = useState(() => readDraft(item.id) ?? item.lastAnswer?.code ?? item.starterCode ?? "");
  const [submission, setSubmission] = useState(null);
  const [running, setRunning] = useState(false);
  const [hints, setHints] = useState(0);
  const alive = useRef(true);
  const open = item.status === "solved" || item.status === "revealed";

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
    setSubmission(null);
    try {
      const created = await arenaApi.runCode(item.id, code, mode);
      setSubmission(created);
      const done = await poll(created.id);
      if (!done) {
        if (alive.current) toast("Still judging — check back in a moment.");
      } else if (done.mode === "submit" && done.status === "passed") {
        toast.success(done.xpGained ? `Accepted! +${done.xpGained} XP` : "Accepted!");
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

        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Function</h2>
          <pre className="overflow-x-auto rounded-lg border border-border bg-muted px-3 py-2 font-mono text-xs">
            {signatureLine(item.signature)}
          </pre>
        </section>

        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Examples</h2>
          <ul className="space-y-2">
            {item.samples.map((s, i) => (
              <li key={i} className="rounded-lg border border-border bg-card px-3 py-2 font-mono text-xs">
                <p className="break-all">{s.call}</p>
                <p className="break-all text-muted-foreground">→ {pretty(s.expected)}</p>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            Submit also runs {item.hiddenTestCount} hidden {item.hiddenTestCount === 1 ? "test" : "tests"}. Numbers are
            compared with a small tolerance; NumPy arrays and lists both work as return values.
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
        ) : signedIn ? (
          <Button variant="ghost" size="sm" onClick={reveal}>
            Show solution
          </Button>
        ) : null}
      </div>

      {/* Editor + results */}
      <div className="flex min-h-[560px] flex-col overflow-hidden rounded-lg border border-border lg:min-h-0">
        <div className="flex items-center gap-2 border-b border-border bg-card px-3 py-2">
          <span className="text-sm font-medium">Python 3 · NumPy</span>
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
            path={`arena-${item.id}.py`}
            language="python"
            theme="vs-dark"
            value={code}
            onChange={change}
            onMount={handleEditorMount}
            options={editorOptions()}
          />
        </div>
        <div className="max-h-[40%] min-h-[96px] overflow-y-auto border-t border-border bg-card p-4" aria-live="polite">
          <Results submission={submission} running={running} />
        </div>
      </div>
    </div>
  );
}
