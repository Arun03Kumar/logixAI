"use client";
import { useState } from "react";
import toast from "react-hot-toast";
import { Button, Input, Spinner, Textarea } from "@logixai/ui";
import FormError from "@/app/components/forms/FormError";
import { examApi } from "@/app/lib/api/exams";

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Marks for one answer. Ticking rubric points fills in the marks (which the
 * grader can still change). onSaved receives the server's GradeResult.
 * Questions with an automatic score can go back to it ("Use automatic score").
 */
export default function GradeForm({ examId, attemptId, question, grade, onSaved, compact = false, autoFocus = false }) {
  const rubric = question.rubric ?? [];
  const [ticked, setTicked] = useState(() => new Set(grade?.rubricIds ?? []));
  const [marks, setMarks] = useState(grade ? String(grade.marks) : "");
  const [comment, setComment] = useState(grade?.comment ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const written = question.type === "short_answer" || question.type === "long_answer";

  const toggle = (id) => {
    const next = new Set(ticked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setTicked(next);
    setMarks(String(round2(rubric.filter((r) => next.has(r.id)).reduce((s, r) => s + r.marks, 0))));
  };

  const save = async (value) => {
    setBusy(true);
    setError(null);
    try {
      const res = await examApi.grade(examId, attemptId, question.questionId ?? question.id, {
        marks: value,
        rubricIds: value === null ? [] : [...ticked],
        comment: value === null ? "" : comment.trim(),
      });
      toast.success(value === null ? "Back to the automatic score." : "Marks saved.");
      onSaved?.(res);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const value = marks === "" ? NaN : Number(marks);
  const valid = Number.isFinite(value) && value >= 0 && value <= question.marks;

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) save(value);
      }}
    >
      <FormError message={error} />
      {rubric.length ? (
        <fieldset className="space-y-1.5">
          <legend className="mb-1 text-sm font-medium">Rubric</legend>
          {rubric.map((r) => (
            <label key={r.id} className="flex cursor-pointer items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 size-4 shrink-0 accent-primary"
                checked={ticked.has(r.id)}
                onChange={() => toggle(r.id)}
              />
              <span className="flex-1">{r.label}</span>
              <span className="text-xs text-muted-foreground">{r.marks}</span>
            </label>
          ))}
        </fieldset>
      ) : null}
      <div className={compact ? "flex flex-wrap items-end gap-2" : "space-y-3"}>
        <label className="flex items-center gap-2 text-sm font-medium">
          Marks
          <Input
            type="number"
            min={0}
            max={question.marks}
            step="0.25"
            value={marks}
            onChange={(e) => setMarks(e.target.value)}
            className="h-9 w-24"
            aria-invalid={marks !== "" && !valid}
            autoFocus={autoFocus}
          />
          <span className="font-normal text-muted-foreground">/ {question.marks}</span>
        </label>
        <Textarea
          aria-label="Comment for the student"
          placeholder="Comment for the student (optional)"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          className={compact ? "min-h-10 flex-1" : "min-h-16"}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" variant="primary" disabled={busy || !valid}>
          {busy ? <Spinner className="text-primary-foreground" /> : null}
          Save marks
        </Button>
        {grade && !written ? (
          <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => save(null)}>
            Use automatic score
          </Button>
        ) : null}
      </div>
    </form>
  );
}
