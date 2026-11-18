"use client";
import React from "react";
import { useSelector } from "react-redux";
import { VerdictBadge, cn } from "@logixai/ui";

function Block({ label, children, danger }) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <pre
        className={cn(
          "whitespace-pre-wrap rounded-md border border-border bg-muted px-3 py-2 font-mono text-xs leading-relaxed",
          danger ? "text-danger" : "text-foreground",
        )}
      >
        {children}
      </pre>
    </div>
  );
}

/** One example test: its input, the expected output and what the code printed. */
export default function TestCaseTab() {
  const problem = useSelector((state) => state.problem.data);
  const runOutput = useSelector((state) => state.runOutput.data);
  const outputTab = useSelector((state) => state.runOutput.outputTab);

  const match = outputTab.match(/^tc-(\d+)$/);
  if (!match) return null;

  const idx = Number(match[1]);
  const tc = problem?.sampleTestCases?.[idx];
  const compileError = runOutput?.response?.length === 1 && runOutput.response[0].status === "CE";
  const resp = compileError ? null : runOutput?.response?.[idx];
  const failed = resp && resp.status !== "SUCCESS" && resp.status !== "WA";

  return (
    <div className="grid gap-3 md:grid-cols-3">
      <Block label="Input">{tc?.input ?? "—"}</Block>
      <Block label="Expected output">{tc?.output ?? "—"}</Block>
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <p className="text-xs font-medium text-muted-foreground">Your output</p>
          <VerdictBadge status={resp?.status} />
          {resp?.timeMs !== undefined ? (
            <span className="text-xs text-muted-foreground">{resp.timeMs} ms</span>
          ) : null}
        </div>
        <pre
          className={cn(
            "whitespace-pre-wrap rounded-md border border-border bg-muted px-3 py-2 font-mono text-xs leading-relaxed",
            failed ? "text-danger" : "text-foreground",
          )}
        >
          {compileError
            ? "Your code didn't compile. See the Result tab."
            : resp
              ? resp.output || (failed ? "(no details)" : "(no output)")
              : runOutput
                ? "Not run."
                : "Run your code to see the output."}
        </pre>
      </div>
    </div>
  );
}
