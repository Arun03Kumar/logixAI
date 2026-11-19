"use client";
import { useState } from "react";
import toast from "react-hot-toast";
import { Download, FileUp, X } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  Checkbox,
  Field,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
} from "@logixai/ui";
import FormError from "@/app/components/forms/FormError";
import { identityApi } from "@/app/lib/api/identity";
import { inScope } from "../../labels";
import { TEMPLATE_CSV, downloadText, parseCsv, toCsv, toStudentRows } from "./csv";

/** identity-service takes at most 500 rows per request. */
const CHUNK = 500;
const MAX_ROWS = 5000;
const NONE = "__none";

const STATUS = {
  created: { label: "New account", tone: "success" },
  added: { label: "Joins", tone: "success" },
  updated: { label: "Updated", tone: "info" },
  unchanged: { label: "No change", tone: "neutral" },
  error: { label: "Problem", tone: "danger" },
};

/** Sends rows in chunks; row numbers stay those of the whole file. */
async function runImport(institutionId, rows, options) {
  const out = { counts: { created: 0, added: 0, updated: 0, unchanged: 0, error: 0 }, rows: [], batchesCreated: [] };
  for (let start = 0; start < rows.length; start += CHUNK) {
    const res = await identityApi.importStudents(institutionId, { ...options, rows: rows.slice(start, start + CHUNK) });
    for (const [k, v] of Object.entries(res.counts)) out.counts[k] += v;
    out.rows.push(...res.rows.map((r) => ({ ...r, row: r.row + start })));
    out.batchesCreated.push(...res.batchesCreated.filter((b) => !out.batchesCreated.includes(b)));
  }
  return out;
}

/**
 * Bulk-adds students from a CSV (or cells pasted from a spreadsheet):
 * check first, then import, then download the sign-in sheet with each new
 * account's temporary password.
 */
export default function ImportPanel({ institution, access, batches, onClose, onImported }) {
  const usable = batches.filter((b) => !b.archived && inScope(access, b.id));
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState(null);
  const [batchId, setBatchId] = useState(access.scope.all ? NONE : (usable[0]?.id ?? NONE));
  const [createBatches, setCreateBatches] = useState(true);
  const [check, setCheck] = useState(null);
  const [done, setDone] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const parsed = text.trim() ? toStudentRows(parseCsv(text)) : { rows: [], columns: [] };
  const options = {
    batchId: batchId === NONE ? null : batchId,
    createBatches: access.scope.all && createBatches,
  };

  const reset = () => {
    setCheck(null);
    setDone(null);
    setError(null);
  };

  const readFile = async (file) => {
    if (!file) return;
    if (file.size > 2_000_000) {
      setError("That file is over 2 MB. Split it into smaller files.");
      return;
    }
    setFileName(file.name);
    setText(await file.text());
    reset();
  };

  const go = async (dryRun) => {
    if (parsed.rows.length > MAX_ROWS) {
      setError(`Import at most ${MAX_ROWS} students at a time.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await runImport(institution.id, parsed.rows, { ...options, dryRun });
      if (dryRun) setCheck(res);
      else {
        setDone(res);
        setCheck(null);
        onImported();
        toast.success(`${res.counts.created + res.counts.added} students added, ${res.counts.updated} updated.`);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const downloadSheet = () => {
    const created = done.rows.filter((r) => r.tempPassword);
    downloadText(
      `${institution.slug}-sign-in-sheet.csv`,
      toCsv([
        ["Name", "Roll number", "Email", "Batch", "Institution code", "Temporary password"],
        ...created.map((r) => [r.name, r.rollNumber ?? "", r.email ?? "", r.batchName ?? "", institution.slug, r.tempPassword]),
      ]),
    );
  };

  const shown = done ?? check;
  const problems = shown?.rows.filter((r) => r.status === "error") ?? [];
  const newAccounts = done?.rows.filter((r) => r.tempPassword).length ?? 0;

  return (
    <Card className="border-primary/40 p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold">Import students</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Columns: <span className="font-medium text-foreground">Name</span>, Roll number, Email, Batch. Each student needs a
            roll number or an email. People who already have a LogixAI account join with it; everyone else gets an account
            with a temporary password.
          </p>
        </div>
        <Button variant="ghost" size="icon-sm" aria-label="Close import" onClick={onClose}>
          <X />
        </Button>
      </div>

      {done ? (
        <div className="mt-4 space-y-3">
          <div className="rounded-lg border border-success/30 bg-success-soft px-4 py-3 text-sm text-success">
            Imported: {done.counts.created} new accounts, {done.counts.added} existing accounts joined, {done.counts.updated} updated
            {done.batchesCreated.length ? `, new batches ${done.batchesCreated.join(", ")}` : ""}.
          </div>
          {newAccounts ? (
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-warning/30 bg-warning-soft px-4 py-3 text-sm">
              <span className="flex-1">
                Download the sign-in sheet now: it has the {newAccounts} temporary passwords and won&apos;t be shown again.
                Students sign in with institution code <span className="font-mono font-semibold">{institution.slug}</span> and
                their roll number (or email), then choose their own password.
              </span>
              <Button size="sm" variant="primary" onClick={downloadSheet}>
                <Download />
                Download sign-in sheet
              </Button>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild size="sm" variant="outline">
              <label className="cursor-pointer">
                <FileUp />
                Choose CSV file
                <input type="file" accept=".csv,text/csv,.txt" className="sr-only" onChange={(e) => readFile(e.target.files?.[0])} />
              </label>
            </Button>
            <Button size="sm" variant="ghost" onClick={() => downloadText("students-template.csv", TEMPLATE_CSV)}>
              <Download />
              Template
            </Button>
            {fileName ? <span className="text-sm text-muted-foreground">{fileName}</span> : null}
          </div>
          <Field label="Or paste rows from a spreadsheet" htmlFor="imp-text">
            <Textarea
              id="imp-text"
              rows={5}
              className="font-mono text-xs"
              placeholder={"Name,Roll number,Email,Batch\nAsha Verma,9A-01,,Class 9A"}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setFileName(null);
                reset();
              }}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Batch for rows without one" htmlFor="imp-batch">
              <Select
                value={batchId}
                onValueChange={(v) => {
                  setBatchId(v);
                  reset();
                }}
              >
                <SelectTrigger id="imp-batch" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {access.scope.all ? <SelectItem value={NONE}>No batch</SelectItem> : null}
                  {usable.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            {access.scope.all ? (
              <Checkbox
                className="self-end pb-2"
                label="Create batches the file names that don't exist yet"
                checked={createBatches}
                onChange={(e) => {
                  setCreateBatches(e.target.checked);
                  reset();
                }}
              />
            ) : null}
          </div>
          <FormError message={error} />
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => go(true)} disabled={busy || !parsed.rows.length}>
              {busy && !check ? <Spinner /> : null}
              Check {parsed.rows.length ? `${parsed.rows.length} rows` : "file"}
            </Button>
            {check ? (
              <Button
                variant="primary"
                onClick={() => go(false)}
                disabled={busy || check.counts.created + check.counts.added + check.counts.updated === 0}
              >
                {busy ? <Spinner className="text-primary-foreground" /> : null}
                Import {check.counts.created + check.counts.added + check.counts.updated} students
              </Button>
            ) : null}
            {parsed.rows.length && !parsed.columns.includes("rollNumber") && !check ? (
              <span className="text-xs text-muted-foreground">No header row found: reading columns as Name, Roll number, Email, Batch.</span>
            ) : null}
          </div>
          {check ? (
            <p className="text-sm text-muted-foreground">
              {check.counts.created} new accounts, {check.counts.added} existing accounts join, {check.counts.updated} updated,{" "}
              {check.counts.unchanged} unchanged, {check.counts.error} with problems
              {check.batchesCreated.length ? `. New batches: ${check.batchesCreated.join(", ")}` : ""}. Rows with problems are
              skipped.
            </p>
          ) : null}
        </div>
      )}

      {shown ? (
        <div className="mt-4 max-h-96 overflow-auto rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-14">Row</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Roll number</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Batch</TableHead>
                <TableHead>Result</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(problems.length && !done ? [...problems, ...shown.rows.filter((r) => r.status !== "error")] : shown.rows).map((r) => (
                <TableRow key={r.row}>
                  <TableCell className="text-muted-foreground">{r.row}</TableCell>
                  <TableCell className="font-medium">{r.name || "—"}</TableCell>
                  <TableCell className="font-mono text-xs">{r.rollNumber ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{r.email ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{r.batchName ?? "—"}</TableCell>
                  <TableCell>
                    <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>
                    {r.message ? <p className="mt-1 text-xs text-muted-foreground">{r.message}</p> : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}
    </Card>
  );
}
