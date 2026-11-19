"use client";
import { useState } from "react";
import toast from "react-hot-toast";
import {
  Button,
  Card,
  Checkbox,
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
import { identityApi } from "@/app/lib/api/identity";
import { inScope } from "../../labels";

/** "2026-27" -> "2027-28", "2026" -> "2027". */
export function nextYear(year) {
  const m = /^(\d{4})(?:-(\d{2}))?$/.exec(year ?? "");
  if (!m) return "";
  const start = Number(m[1]) + 1;
  return m[2] ? `${start}-${String((start + 1) % 100).padStart(2, "0")}` : String(start);
}

/** "CSE 2026" -> "CSE 2027"; "Class 9A" -> "Class 9A 2027-28". */
function suggestName(batch) {
  const year = /^(\d{4})/.exec(batch.academicYear ?? "")?.[1];
  if (year && batch.name.includes(year)) return batch.name.replace(year, String(Number(year) + 1));
  const next = nextYear(batch.academicYear);
  return next ? `${batch.name} ${next}` : "";
}

/**
 * Year rollover for one batch: move its students into a new batch (or an
 * existing one) and, usually, archive the old batch. To graduate a batch,
 * archive it instead: students only in archived batches don't use seats.
 */
export default function PromotePanel({ institutionId, access, batch, batches, onDone, onCancel }) {
  const targets = batches.filter((b) => b.id !== batch.id && !b.archived && inScope(access, b.id));
  const [mode, setMode] = useState("new");
  const [name, setName] = useState(() => suggestName(batch));
  const [year, setYear] = useState(() => nextYear(batch.academicYear));
  const [toBatchId, setToBatchId] = useState(targets[0]?.id ?? "");
  const [archive, setArchive] = useState(true);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    setErrors({});
    try {
      const res = await identityApi.promoteBatch(institutionId, batch.id, {
        ...(mode === "new" ? { newBatch: { name, academicYear: year.trim() || null } } : { toBatchId }),
        archiveSource: archive,
      });
      toast.success(`Moved ${res.moved} student${res.moved === 1 ? "" : "s"} to ${res.to.name}.`);
      onDone();
    } catch (err) {
      setErrors(err.fieldErrors ?? {});
      setFormError(err.message);
      setSaving(false);
    }
  };

  return (
    <Card className="border-primary/40 p-5">
      <h2 className="text-sm font-semibold">Move {batch.name} to next year</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Moves its {batch.memberCount ? `${batch.memberCount} ` : ""}students. Staff stay where they are, and past tests and
        reports keep the old batch.
      </p>
      <form onSubmit={submit} className="mt-4 space-y-4">
        <FormError message={formError} />
        <div className="flex flex-wrap gap-5">
          <Checkbox type="radio" name="promote-mode" label="Into a new batch" checked={mode === "new"} onChange={() => setMode("new")} />
          <Checkbox
            type="radio"
            name="promote-mode"
            label="Into an existing batch"
            checked={mode === "existing"}
            disabled={!targets.length}
            onChange={() => setMode("existing")}
          />
        </div>
        {mode === "new" ? (
          <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
            <Field label="New batch name" htmlFor="pr-name" error={errors.newBatch}>
              <Input id="pr-name" value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Year" htmlFor="pr-year">
              <Input id="pr-year" placeholder="2027-28" value={year} onChange={(e) => setYear(e.target.value)} />
            </Field>
          </div>
        ) : (
          <Field label="Batch" htmlFor="pr-to" error={errors.toBatchId}>
            <Select value={toBatchId} onValueChange={setToBatchId}>
              <SelectTrigger id="pr-to" className="w-full sm:w-72">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {targets.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        )}
        <Checkbox
          label={`Archive ${batch.name} afterwards`}
          description="Archived batches stay in reports but get no new invites or tests."
          checked={archive}
          onChange={(e) => setArchive(e.target.checked)}
        />
        <div className="flex gap-2">
          <Button type="submit" variant="primary" disabled={saving || (mode === "new" ? !name.trim() : !toBatchId)}>
            {saving ? <Spinner className="text-primary-foreground" /> : null}
            Move students
          </Button>
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}
