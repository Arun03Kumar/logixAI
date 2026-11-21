"use client";
import { useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { ArrowLeft, RotateCcw } from "lucide-react";
import { Button, Container, PageHeader, Spinner, cn } from "@logixai/ui";
import AppHeader from "@/app/components/layout/AppHeader";
import { configureJsx, editorOptions, handleEditorMount } from "@/app/coding-platform/components/problem/editorConfig";
import LivePreview from "@/app/arena/_components/LivePreview";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
  loading: () => (
    <div className="grid h-full place-items-center bg-[#1e1e1e]">
      <Spinner />
    </div>
  ),
});

const STARTERS = {
  react: `import { useEffect, useState } from "react";

// Edit me: the preview updates as you type.
export default function App() {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query), 400);
    return () => clearTimeout(timer);
  }, [query]);

  return (
    <div>
      <h3>Debounced search</h3>
      <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Type fast..." />
      <p>Searching for: <b>{debounced || "(nothing yet)"}</b></p>
    </div>
  );
}
`,
  script: `// Plain JavaScript: console output shows below.
console.log("sync");
setTimeout(() => console.log("timer"), 0);
Promise.resolve().then(() => console.log("microtask"));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  for (const n of [1, 2, 3]) {
    await sleep(300);
    console.log("tick", n);
  }
})();
`,
};

const MODES = [
  ["react", "React"],
  ["script", "JavaScript"],
];

const draftKey = (mode) => `playground-draft:${mode}`;
function readDraft(mode) {
  try {
    return window.localStorage.getItem(draftKey(mode));
  } catch {
    return null;
  }
}
function writeDraft(mode, code) {
  try {
    window.localStorage.setItem(draftKey(mode), code);
  } catch {
    // Storage unavailable: the code just isn't kept.
  }
}

export default function PlaygroundPage() {
  const [mode, setMode] = useState("react");
  const [code, setCode] = useState(() => (typeof window === "undefined" ? STARTERS.react : (readDraft("react") ?? STARTERS.react)));

  const switchMode = (next) => {
    if (next === mode) return;
    setMode(next);
    setCode(readDraft(next) ?? STARTERS[next]);
  };
  const change = (value) => {
    setCode(value ?? "");
    writeDraft(mode, value ?? "");
  };
  const reset = () => {
    if (!window.confirm("Replace your code with the example?")) return;
    change(STARTERS[mode]);
  };

  return (
    <>
      <AppHeader />
      <main className="py-6">
        <Container size="xl" className="space-y-4">
          <Link href="/practice" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-4" />
            Practice
          </Link>
          <PageHeader
            title="JavaScript and React playground"
            description="A scratchpad that runs in your browser, in an isolated frame. Imports: react and react-dom. Your code is kept on this device only."
          />
          <div className="grid gap-4 lg:h-[calc(100vh-15rem)] lg:grid-cols-2">
            <div className="flex min-h-[480px] flex-col overflow-hidden rounded-lg border border-border lg:min-h-0">
              <div className="flex items-center gap-1 border-b border-border bg-card px-2 py-1.5" role="tablist" aria-label="Mode">
                {MODES.map(([key, label]) => (
                  <button
                    key={key}
                    role="tab"
                    aria-selected={mode === key}
                    onClick={() => switchMode(key)}
                    className={cn(
                      "rounded-md px-3 py-1 text-sm font-medium",
                      mode === key ? "bg-primary-soft text-primary" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {label}
                  </button>
                ))}
                <Button variant="ghost" size="sm" className="ml-auto" onClick={reset} aria-label="Reset to the example">
                  <RotateCcw />
                </Button>
              </div>
              <div className="min-h-[400px] flex-1 bg-[#1e1e1e]">
                <MonacoEditor
                  height="100%"
                  path={`playground.${mode === "react" ? "jsx" : "js"}`}
                  language="javascript"
                  theme="vs-dark"
                  value={code}
                  onChange={change}
                  beforeMount={configureJsx}
                  onMount={handleEditorMount}
                  options={editorOptions({ tabSize: 2 })}
                />
              </div>
            </div>
            <div className="flex min-h-[400px] flex-col overflow-hidden rounded-lg border border-border lg:min-h-0">
              <div className="border-b border-border bg-card px-3 py-2 text-sm font-medium">
                {mode === "react" ? "Live preview" : "Console"}
              </div>
              <LivePreview key={mode} code={code} mode={mode} className="flex-1" />
            </div>
          </div>
        </Container>
      </main>
    </>
  );
}
