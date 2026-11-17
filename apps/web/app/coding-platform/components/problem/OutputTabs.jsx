"use client";
import React from "react";
import { useSelector, useDispatch } from "react-redux";
import { Spinner, Tabs, VerdictBadge } from "@logixai/ui";
import { setOutputTab } from "@/app/coding-platform/store/runOutputSlice";
import TestCaseTab from "./TestCaseTab";

const MAX_TEST_TABS = 3;

export default function OutputTabs() {
  const dispatch = useDispatch();
  const problem = useSelector((state) => state.problem.data);
  const { data, outputTab, isJudging, isRunning, isSubmitting, error } =
    useSelector((state) => state.runOutput);

  const testCount = Math.min(problem?.testCases?.length || 0, MAX_TEST_TABS);
  const items = [
    { value: "result", label: "Result" },
    ...Array.from({ length: testCount }, (_, i) => ({
      value: `tc-${i}`,
      label: (
        <>
          Test {i + 1}
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
            Judging…
          </span>
        ) : (
          <VerdictBadge status={data?.status} />
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto border-t border-border px-4 py-3">
        {outputTab === "result" ? (
          <ResultPanel data={data} error={error} busy={busy} />
        ) : (
          <TestCaseTab />
        )}
      </div>
    </div>
  );
}

function StatusDot({ status }) {
  if (!status) return null;
  const color =
    status === "SUCCESS"
      ? "bg-success"
      : status === "WA"
        ? "bg-danger"
        : "bg-warning";
  return (
    <span
      aria-label={status}
      className={`inline-block size-1.5 rounded-full ${color}`}
    />
  );
}

function ResultPanel({ data, error, busy }) {
  if (error) {
    return <p className="text-sm text-danger">{error}</p>;
  }
  if (busy && !data) {
    return (
      <p className="text-sm text-muted-foreground">
        Your code is queued and running against the test cases.
      </p>
    );
  }
  if (!data) {
    return (
      <p className="text-sm text-muted-foreground">
        Run your code to see the verdict here.
      </p>
    );
  }

  const results = data.response || [];
  const passed = results.filter((r) => r.status === "SUCCESS").length;
  const firstError = results.find((r) => r.status === "ERROR");

  return (
    <div className="space-y-3">
      <p className="text-sm">
        <span className="font-semibold">
          {passed} of {results.length}
        </span>{" "}
        <span className="text-muted-foreground">tests passed</span>
      </p>
      {firstError ? (
        <pre className="max-h-32 overflow-auto rounded-md border border-border bg-muted px-3 py-2 font-mono text-xs leading-relaxed text-danger whitespace-pre-wrap">
          {firstError.output}
        </pre>
      ) : null}
    </div>
  );
}
