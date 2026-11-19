"use client";
import { useState } from "react";
import toast from "react-hot-toast";
import { Archive, ArchiveRestore, ArrowUpRight, Layers } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  Checkbox,
  EmptyState,
  Field,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@logixai/ui";
import { identityApi } from "@/app/lib/api/identity";
import { useApi } from "@/app/lib/api/useApi";
import { can, formatDate, inScope } from "../../labels";
import PromotePanel from "./PromotePanel";

const NONE = "__none";

/** "2026-27" for the academic year that starts this June (Indian calendar). */
function currentAcademicYear() {
  const d = new Date();
  const start = d.getMonth() >= 5 ? d.getFullYear() : d.getFullYear() - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

function CreateBatch({ institutionId, access, departments, onCreated }) {
  // Department heads add batches to their own departments only.
  const choices = access.scope.all ? departments : departments.filter((d) => access.scope.departmentIds.includes(d.id));
  const [form, setForm] = useState({
    name: "",
    departmentId: access.scope.all ? NONE : (choices[0]?.id ?? NONE),
    academicYear: currentAcademicYear(),
  });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  const create = async (e) => {
    e.preventDefault();
    setSaving(true);
    setErrors({});
    try {
      const batch = await identityApi.createBatch(institutionId, {
        name: form.name,
        departmentId: form.departmentId === NONE ? null : form.departmentId,
        ...(form.academicYear.trim() ? { academicYear: form.academicYear.trim() } : {}),
      });
      onCreated(batch);
      setForm((f) => ({ ...f, name: "" }));
      toast.success(`Batch “${batch.name}” created.`);
    } catch (err) {
      setErrors(err.fieldErrors ?? {});
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="p-5">
      <h2 className="text-sm font-semibold">Add a batch</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Batches group students (a class, section or year) so tests and practice can be assigned to them.
      </p>
      <form onSubmit={create} className="mt-4 grid gap-3 sm:grid-cols-[1fr_200px_130px_auto] sm:items-end">
        <Field label="Name" htmlFor="b-name" error={errors.name}>
          <Input id="b-name" placeholder="CSE 2026, Section A" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
        </Field>
        <Field label="Department" htmlFor="b-dept" error={errors.departmentId}>
          <Select value={form.departmentId} onValueChange={(departmentId) => setForm((f) => ({ ...f, departmentId }))}>
            <SelectTrigger id="b-dept" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {access.scope.all ? <SelectItem value={NONE}>No department</SelectItem> : null}
              {choices.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Year" htmlFor="b-year" error={errors.academicYear}>
          <Input id="b-year" placeholder="2026-27" value={form.academicYear} onChange={(e) => setForm((f) => ({ ...f, academicYear: e.target.value }))} />
        </Field>
        <Button type="submit" disabled={saving || !form.name.trim() || (!access.scope.all && form.departmentId === NONE)}>
          {saving ? <Spinner /> : null}
          Add batch
        </Button>
      </form>
    </Card>
  );
}

export default function BatchesTab({ institutionId, access }) {
  const batches = useApi(() => identityApi.listBatches(institutionId), [institutionId]);
  const departments = useApi(() => identityApi.listDepartments(institutionId), [institutionId]);
  const [showArchived, setShowArchived] = useState(false);
  const [promoting, setPromoting] = useState(null);
  const manages = can(access, "structure.manage");
  const deptName = new Map((departments.data ?? []).map((d) => [d.id, d.name]));

  const sortRows = (rows) => [...rows].sort((a, b) => a.name.localeCompare(b.name));
  const setArchived = async (batch, archived) => {
    if (
      archived &&
      !window.confirm(
        `Archive ${batch.name}? It stays in reports but can't get new invites or tests. Students only in archived batches stop using seats.`,
      )
    )
      return;
    try {
      const updated = await identityApi.updateBatch(institutionId, batch.id, { archived });
      batches.setData((rows) => (rows ?? []).map((b) => (b.id === updated.id ? updated : b)));
      toast.success(archived ? `${batch.name} archived.` : `${batch.name} restored.`);
    } catch (err) {
      toast.error(err.message);
    }
  };

  const all = batches.data ?? [];
  const archivedCount = all.filter((b) => b.archived).length;
  const rows = all.filter((b) => showArchived || !b.archived);

  return (
    <div className="space-y-4">
      {manages && departments.data ? (
        <CreateBatch
          institutionId={institutionId}
          access={access}
          departments={departments.data}
          onCreated={(batch) => batches.setData((list) => sortRows([...(list ?? []), batch]))}
        />
      ) : null}

      {promoting ? (
        <PromotePanel
          key={promoting.id}
          institutionId={institutionId}
          access={access}
          batch={promoting}
          batches={all}
          onCancel={() => setPromoting(null)}
          onDone={() => {
            setPromoting(null);
            batches.reload();
          }}
        />
      ) : null}

      {archivedCount ? (
        <Checkbox
          label={`Show archived batches (${archivedCount})`}
          checked={showArchived}
          onChange={(e) => setShowArchived(e.target.checked)}
        />
      ) : null}

      <Card className="overflow-hidden">
        {batches.loading ? (
          <div className="space-y-3 p-5">
            <Skeleton className="h-5 w-1/3" />
          </div>
        ) : batches.error ? (
          <EmptyState title="Couldn't load batches" description={batches.error.message} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<Layers />}
            title="No batches yet"
            description="Create a batch, then attach it to an invite so students land in the right group."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Batch</TableHead>
                <TableHead>Department</TableHead>
                <TableHead>Year</TableHead>
                <TableHead>Members</TableHead>
                <TableHead>Created</TableHead>
                {manages ? (
                  <TableHead className="w-20">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                ) : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((batch) => (
                <TableRow key={batch.id}>
                  <TableCell className="font-medium">
                    {batch.name}
                    {batch.archived ? (
                      <Badge tone="neutral" className="ml-2">
                        Archived
                      </Badge>
                    ) : null}
                    {!inScope(access, batch.id) ? (
                      <Badge tone="outline" className="ml-2">
                        Not yours
                      </Badge>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{batch.departmentId ? (deptName.get(batch.departmentId) ?? "—") : "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{batch.academicYear ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{batch.memberCount}</TableCell>
                  <TableCell className="text-muted-foreground">{formatDate(batch.createdAt)}</TableCell>
                  {manages ? (
                    <TableCell>
                      {inScope(access, batch.id) ? (
                        <div className="flex justify-end gap-1">
                          {!batch.archived && batch.memberCount > 0 ? (
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              title="Move students to next year"
                              aria-label={`Move ${batch.name} to next year`}
                              onClick={() => setPromoting(batch)}
                            >
                              <ArrowUpRight />
                            </Button>
                          ) : null}
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            title={batch.archived ? "Restore" : "Archive"}
                            aria-label={batch.archived ? `Restore ${batch.name}` : `Archive ${batch.name}`}
                            onClick={() => setArchived(batch, !batch.archived)}
                          >
                            {batch.archived ? <ArchiveRestore /> : <Archive />}
                          </Button>
                        </div>
                      ) : null}
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
