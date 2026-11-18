"use client";
import React from "react";
import { useSelector, useDispatch } from "react-redux";
import { Spinner, Tabs, VerdictBadge, cn } from "@logixai/ui";
import { setOutputTab } from "@/app/coding-platform/store/runOutputSlice";
import TestCaseTab from "./TestCaseTab";

/** Verdicts that mean the program failed (rather than printed a wrong answer). */
const FAILURES = ["TLE", "MLE", "RE", "CE", "ERROR"];

const dotColor = (status) =>
  status === "SUCCESS" ? "bg-success" : status === "WA" ? "bg-danger" : "bg-warning";

function StatusDot({ status }) {
  if (!status) return null;
  return <span aria-label={status} className={`inline-block size-1.5 rounded-full ${dotColor(status)}`} />;
}

export default function OutputTabs() {
  const dispatch = useDispatch();
  const problem = useSelector((state) => state.problem.data);
  const { data, outputTab, isJudging, isRunning, isSubmitting, error, mode } = useSelector(
    (state) => state.runOutput,
  );

  const samples = problem?.sampleTestCases ?? [];
  const items = [
    { value: "result", label: "Result" },
    ...samples.map((_, i) => ({
      value: `tc-${i}`,
      label: (
        <>
          Example {i + 1}
          <StatusDot status={data?.response?.[i]?.status} />
        </>
      ),
    })),
  ];

  const busy = isJudging || isRunning || isSubmitting;

  return (
    <div className="flex h-56 shrink-0 flex-col border-t border-border bg-background">
      <div className="flex items-center justify-between gap-3 px-4">
        <Tabs
          size="sm"
          aria-label="Run output"
          items={items}
          value={outputTab}
          onValueChange={(tab) => dispatch(setOutputTab(tab))}
          className="flex-1 border-b-0"
        />
        {busy ? (
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            <Spinner className="size-3.5" />
            {mode === "run" ? "Running examples…" : "Judging…"}
          </span>
        ) : (
          <VerdictBadge status={data?.status} />
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto border-t border-border px-4 py-3">
        {outputTab === "result" ? (
          <ResultPanel data={data} error={error} busy={busy} mode={mode} hiddenCount={problem?.hiddenTestCount ?? 0} />
        ) : (
          <TestCaseTab />
        )}
      </div>
    </div>
  );
}

function ResultPanel({ data, error, busy, mode, hiddenCount }) {
  if (error) {
    return <p className="text-sm text-danger">{error}</p>;
  }
  if (busy && !data) {
    return (
      <p className="text-sm text-muted-foreground">
        {mode === "run"
          ? "Running your code on the examples."
          : "Your code is queued and running against all tests."}
      </p>
    );
  }
  if (!data) {
    return (
      <p className="text-sm text-muted-foreground">
        Run checks your code against the examples. Submit checks it against
        the examples and {hiddenCount} hidden {hiddenCount === 1 ? "test" : "tests"}.
      </p>
    );
  }

  const results = data.response || [];
  const compileError = results.length === 1 && results[0].status === "CE";
  const sampleCount = data.sampleCount ?? results.length;
  const passed = results.filter((r) => r.status === "SUCCESS").length;
  const firstFailure = results.findIndex((r) => r.status !== "SUCCESS");
  const failure = results[firstFailure];
  const hidden = firstFailure >= sampleCount;

  return (
    <div className="space-y-3">
      <p className="text-sm">
        <span className="font-medium text-muted-foreground">
          {data.mode === "run" ? "Examples" : "Submission"} ·{" "}
        </span>
        {compileError ? (
          <span className="font-semibold text-danger">Your code didn&apos;t compile</span>
        ) : (
          <>
            <span className="font-semibold">
              {passed} of {results.length}
            </span>{" "}
            <span className="text-muted-foreground">tests passed</span>
          </>
        )}
      </p>
      {failure && FAILURES.includes(failure.status) && failure.output ? (
        <pre
          className={cn(
            "max-h-32 overflow-auto rounded-md border border-border bg-muted px-3 py-2 font-mono text-xs leading-relaxed whitespace-pre-wrap",
            "text-danger",
          )}
        >
          {failure.output}
        </pre>
      ) : null}
      {failure && hidden && !compileError ? (
        <p className="text-sm text-muted-foreground">
          Test {firstFailure + 1} is hidden, so its input and output aren&apos;t shown.
        </p>
      ) : null}
      {failure && !hidden && !compileError && failure.status === "WA" ? (
        <p className="text-sm text-muted-foreground">
          Open Example {firstFailure + 1} to compare your output with the expected one.
        </p>
      ) : null}
    </div>
  );
}
