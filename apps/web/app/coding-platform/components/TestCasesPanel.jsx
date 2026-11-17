"use client";
import React from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button, Card, Textarea } from "@logixai/ui";

export default function TestCasesPanel({ testCases, setTestCases }) {
  const updateField = (index, field, value) => {
    setTestCases((prev) =>
      prev.map((tc, i) => (i === index ? { ...tc, [field]: value } : tc)),
    );
  };

  const addTestCase = () => {
    setTestCases((prev) => [...prev, { input: "", output: "" }]);
  };

  const removeTestCase = (index) => {
    setTestCases((prev) => prev.filter((_, i) => i !== index));
  };

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div>
        <h2 className="text-base font-semibold">Test cases</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Each submission runs against every case. The first three are shown to
          students as examples. Rows missing input or output are skipped.
        </p>
      </div>

      {testCases.map((tc, idx) => (
        <Card key={idx}>
          <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
            <p className="text-sm font-medium">Case {idx + 1}</p>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Remove case ${idx + 1}`}
              onClick={() => removeTestCase(idx)}
              disabled={testCases.length === 1}
            >
              <Trash2 />
            </Button>
          </div>
          <div className="grid gap-4 p-4 md:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">
                Input
              </span>
              <Textarea
                value={tc.input}
                onChange={(e) => updateField(idx, "input", e.target.value)}
                placeholder="5"
                className="h-28 resize-y font-mono text-[13px]"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">
                Expected output
              </span>
              <Textarea
                value={tc.output}
                onChange={(e) => updateField(idx, "output", e.target.value)}
                placeholder="25"
                className="h-28 resize-y font-mono text-[13px]"
              />
            </label>
          </div>
        </Card>
      ))}

      <Button onClick={addTestCase}>
        <Plus />
        Add test case
      </Button>
    </div>
  );
}
