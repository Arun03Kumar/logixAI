"use client";
import { useEffect, useRef, useState } from "react";
import { RotateCcw } from "lucide-react";
import { Button, cn } from "@logixai/ui";

/*
 * Renders learner code live in a sandboxed iframe (allow-scripts only: an
 * opaque origin, so the code can't reach this app's cookies or storage). The
 * runtime (public/arena-preview/runtime.js, built by scripts/build-preview.mjs)
 * compiles JSX with Sucrase and renders with React.
 *
 * The page fetches the runtime once (same origin) and inlines it into the
 * frame's srcdoc: a script request from the frame's opaque "null" origin can
 * be refused (private-network rules, browser site permissions).
 */
let runtimeText = null;
function loadRuntime() {
  runtimeText ??= fetch("/arena-preview/runtime.js").then((res) => {
    if (!res.ok) throw new Error(`The preview runtime didn't load (${res.status}).`);
    return res.text();
  });
  return runtimeText;
}

const srcDoc = (runtime) => `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;padding:16px;font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;color:#1f2328;background:#fff}
button{font:inherit;padding:4px 12px;margin:2px;border:1px solid #c9ccd1;border-radius:6px;background:#f6f7f8;color:inherit;cursor:pointer}
button:disabled{opacity:.45;cursor:not-allowed}
input,textarea,select{font:inherit;padding:4px 8px;margin:2px;border:1px solid #c9ccd1;border-radius:6px}
input[type=checkbox]{margin-right:8px}
[role=tab][aria-selected=true]{border-color:#c2410c;color:#c2410c;background:#fff7ed}
[role=tabpanel]{padding:8px 4px}
ul{padding-left:20px}
</style></head><body><div id="root"></div><script>${runtime.replace(/<\/script/gi, "<\\/script")}</script></body></html>`;

const LEVEL_STYLE = {
  error: "text-danger",
  warn: "text-warning",
  log: "text-foreground",
  info: "text-muted-foreground",
};

/**
 * mode "react": render `component` (or the default export / App) with `props`.
 * mode "script": just run the code and show its console output.
 */
export default function LivePreview({ code, component, props, mode = "react", delay = 500, className, consoleClassName }) {
  const frame = useRef(null);
  const ready = useRef(false);
  const latest = useRef(null);
  const [nonce, setNonce] = useState(0);
  const [logs, setLogs] = useState([]);
  const [doc, setDoc] = useState(null);
  const propsKey = JSON.stringify(props ?? {});

  useEffect(() => {
    let active = true;
    loadRuntime().then(
      (text) => active && setDoc(srcDoc(text)),
      (err) => {
        runtimeText = null;
        if (active) setLogs([{ level: "error", text: err.message }]);
      },
    );
    return () => {
      active = false;
    };
  }, []);

  // The message to send once the frame is ready (kept current for the listener below).
  useEffect(() => {
    latest.current = { type: "run", code, component, props: JSON.parse(propsKey), mode };
  });

  useEffect(() => {
    ready.current = false;
    const onMessage = (event) => {
      if (!frame.current || event.source !== frame.current.contentWindow) return;
      const msg = event.data;
      if (!msg || msg.source !== "lx-preview") return;
      if (msg.type === "ready") {
        ready.current = true;
        frame.current.contentWindow.postMessage(latest.current, "*");
      } else if (msg.type === "reset") {
        setLogs([]);
      } else if (msg.type === "console" || msg.type === "error") {
        setLogs((l) => [...l.slice(-199), { level: msg.type === "error" ? "error" : msg.level, text: msg.text }]);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [nonce]);

  useEffect(() => {
    const timer = setTimeout(() => {
      // Scripts get a fresh frame each run, so timers from the last run stop.
      if (mode === "script") setNonce((n) => n + 1);
      else if (ready.current && frame.current?.contentWindow) frame.current.contentWindow.postMessage(latest.current, "*");
    }, delay);
    return () => clearTimeout(timer);
  }, [code, component, propsKey, mode, delay]);

  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      <div className={cn("relative min-h-0", mode === "script" ? "h-0" : "flex-1")}>
        {doc ? (
          <iframe
            key={nonce}
            ref={frame}
            title="Live preview"
            sandbox="allow-scripts"
            srcDoc={doc}
            className={cn("size-full border-0 bg-white", mode === "script" && "hidden")}
          />
        ) : (
          <p className={cn("p-4 text-sm text-muted-foreground", mode === "script" && "hidden")}>Loading preview…</p>
        )}
        <Button
          variant="ghost"
          size="sm"
          className={cn("absolute right-1 top-1", mode === "script" && "hidden")}
          aria-label="Restart preview"
          title="Restart (if the preview is stuck)"
          onClick={() => setNonce((n) => n + 1)}
        >
          <RotateCcw />
        </Button>
      </div>
      <div
        className={cn(
          "overflow-y-auto border-t border-border bg-card px-3 py-2 font-mono text-xs",
          mode === "script" ? "min-h-0 flex-1" : "max-h-28",
          !logs.length && mode !== "script" && "hidden",
          consoleClassName,
        )}
        aria-live="polite"
      >
        {logs.length ? (
          logs.map((l, i) => (
            <p key={i} className={cn("whitespace-pre-wrap break-all", LEVEL_STYLE[l.level] ?? "text-foreground")}>
              {l.text}
            </p>
          ))
        ) : (
          <p className="text-muted-foreground">Console output appears here.</p>
        )}
      </div>
    </div>
  );
}
