"use client";
import React from "react";
import { useSelector } from "react-redux";
import { VerdictBadge } from "@logixai/ui";

function Block({ label, children, tone }) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <pre
        className={`whitespace-pre-wrap rounded-md border border-border bg-muted px-3 py-2 font-mono text-xs leading-relaxed ${
          tone === "danger" ? "text-danger" : "text-foreground"
        }`}
      >
        {children}
      </pre>
    </div>
  );
}

export default function TestCaseTab() {
  const problem = useSelector((state) => state.problem.data);
  const runOutput = useSelector((state) => state.runOutput.data);
  const outputTab = useSelector((state) => state.runOutput.outputTab);

  const match = outputTab.match(/^tc-(\d+)$/);
  if (!match) return null;

  const idx = Number(match[1]);
  const tc = problem?.testCases?.[idx];
  const resp = runOutput?.response?.[idx];

  return (
    <div className="grid gap-3 md:grid-cols-3">
      <Block label="Input">{tc?.input ?? "—"}</Block>
      <Block label="Expected output">{tc?.output ?? "—"}</Block>
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <p className="text-xs font-medium text-muted-foreground">
            Your output
          </p>
          <VerdictBadge status={resp?.status} />
        </div>
        <pre
          className={`whitespace-pre-wrap rounded-md border border-border bg-muted px-3 py-2 font-mono text-xs leading-relaxed ${
            resp?.status === "ERROR" ? "text-danger" : "text-foreground"
          }`}
        >
          {resp
            ? resp.output || "(no output)"
            : runOutput
              ? "Not run: an earlier test stopped the judge."
              : "Run your code to see the output."}
        </pre>
      </div>
    </div>
  );
}
