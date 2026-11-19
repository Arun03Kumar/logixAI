"use client";
import { useState } from "react";
import toast from "react-hot-toast";
import {
  Button,
  Card,
  Field,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
} from "@logixai/ui";
import FormError from "@/app/components/forms/FormError";
import { examApi } from "@/app/lib/api/exams";
import { DIFFICULTY, cloneQuestion } from "@/app/lib/exams/format";

const NONE = "none";

/** Copies one exam question into the institution's bank with a topic, tags and difficulty. */
export default function SaveToBankPanel({ institutionId, question, onDone }) {
  const [topic, setTopic] = useState("");
  const [tags, setTags] = useState("");
  const [difficulty, setDifficulty] = useState(NONE);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await examApi.addToBank(institutionId, {
        question: cloneQuestion(question),
        topic: topic.trim(),
        tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
        difficulty: difficulty === NONE ? null : difficulty,
      });
      toast.success("Saved to the question bank.");
      onDone();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  };

  return (
    <Card className="border-primary/40 p-5">
      <form onSubmit={save} className="space-y-4">
        <div>
          <h3 className="text-sm font-semibold">Save to question bank</h3>
          <p className="text-xs text-muted-foreground">
            Everyone who sets exams in your institution can reuse it. Later edits here don&apos;t change the bank copy.
          </p>
        </div>
        <FormError message={error} />
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Topic" htmlFor={`bank-topic-${question.id}`}>
            <Input id={`bank-topic-${question.id}`} value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="e.g. Recursion" />
          </Field>
          <Field label="Tags" htmlFor={`bank-tags-${question.id}`} hint="Separate with commas.">
            <Input id={`bank-tags-${question.id}`} value={tags} onChange={(e) => setTags(e.target.value)} placeholder="unit-2, theory" />
          </Field>
          <Field label="Difficulty" htmlFor={`bank-diff-${question.id}`}>
            <Select value={difficulty} onValueChange={setDifficulty}>
              <SelectTrigger id={`bank-diff-${question.id}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Not set</SelectItem>
                {Object.entries(DIFFICULTY).map(([value, d]) => (
                  <SelectItem key={value} value={value}>
                    {d.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
        <div className="flex gap-2">
          <Button type="submit" variant="primary" disabled={saving}>
            {saving ? <Spinner className="text-primary-foreground" /> : null}
            Save to bank
          </Button>
          <Button type="button" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}
