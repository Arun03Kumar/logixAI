"use client";
import { Plus, Trash2 } from "lucide-react";
import { Button, Textarea } from "@logixai/ui";

/** Editable list of { input, output } pairs. */
export default function TestCaseList({ label, hint, cases, onChange, max }) {
  const update = (index, field, value) =>
    onChange(cases.map((c, i) => (i === index ? { ...c, [field]: value } : c)));

  return (
    <div className="space-y-2">
      <div>
        <p className="text-sm font-medium">{label}</p>
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      </div>
      {cases.map((tc, i) => (
        <div key={i} className="grid grid-cols-[1fr_1fr_auto] items-start gap-2">
          <Textarea
            aria-label={`${label} ${i + 1} input`}
            placeholder="Input"
            value={tc.input}
            onChange={(e) => update(i, "input", e.target.value)}
            className="min-h-16 font-mono text-[13px]"
          />
          <Textarea
            aria-label={`${label} ${i + 1} expected output`}
            placeholder="Expected output"
            value={tc.output}
            onChange={(e) => update(i, "output", e.target.value)}
            className="min-h-16 font-mono text-[13px]"
          />
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Remove ${label.toLowerCase()} ${i + 1}`}
            onClick={() => onChange(cases.filter((_, j) => j !== i))}
          >
            <Trash2 />
          </Button>
        </div>
      ))}
      {cases.length < max ? (
        <Button size="sm" variant="ghost" onClick={() => onChange([...cases, { input: "", output: "" }])}>
          <Plus />
          Add test
        </Button>
      ) : null}
    </div>
  );
}
