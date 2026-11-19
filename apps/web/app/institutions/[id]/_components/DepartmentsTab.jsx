"use client";
import { useState } from "react";
import toast from "react-hot-toast";
import { Building, Check, Pencil, Trash2, X } from "lucide-react";
import {
  Button,
  Card,
  EmptyState,
  Field,
  Input,
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
import { can } from "../../labels";

const byName = (rows) => [...rows].sort((a, b) => a.name.localeCompare(b.name));

function Row({ department, institutionId, manages, onSaved, onDeleted }) {
  const [editing, setEditing] = useState(null);

  const save = async () => {
    try {
      onSaved(await identityApi.updateDepartment(institutionId, department.id, editing));
      setEditing(null);
      toast.success("Department updated.");
    } catch (err) {
      toast.error(err.fieldErrors?.name ?? err.message);
    }
  };
  const remove = async () => {
    if (!window.confirm(`Delete ${department.name}?`)) return;
    try {
      await identityApi.deleteDepartment(institutionId, department.id);
      onDeleted(department.id);
      toast.success(`${department.name} deleted.`);
    } catch (err) {
      toast.error(err.message);
    }
  };

  if (editing) {
    return (
      <TableRow>
        <TableCell>
          <Input aria-label="Department name" value={editing.name} onChange={(e) => setEditing((x) => ({ ...x, name: e.target.value }))} />
        </TableCell>
        <TableCell>
          <Input aria-label="Department code" className="w-28" value={editing.code} onChange={(e) => setEditing((x) => ({ ...x, code: e.target.value }))} />
        </TableCell>
        <TableCell className="text-muted-foreground">{department.batchCount}</TableCell>
        <TableCell>
          <div className="flex gap-1">
            <Button variant="ghost" size="icon-sm" aria-label="Save" onClick={save}>
              <Check />
            </Button>
            <Button variant="ghost" size="icon-sm" aria-label="Cancel" onClick={() => setEditing(null)}>
              <X />
            </Button>
          </div>
        </TableCell>
      </TableRow>
    );
  }
  return (
    <TableRow>
      <TableCell className="font-medium">{department.name}</TableCell>
      <TableCell className="font-mono text-muted-foreground">{department.code || "—"}</TableCell>
      <TableCell className="text-muted-foreground">{department.batchCount}</TableCell>
      <TableCell>
        {manages ? (
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Rename ${department.name}`}
              onClick={() => setEditing({ name: department.name, code: department.code })}
            >
              <Pencil />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Delete ${department.name}`}
              disabled={department.batchCount > 0}
              title={department.batchCount > 0 ? "Move or archive its batches first" : undefined}
              onClick={remove}
            >
              <Trash2 />
            </Button>
          </div>
        ) : null}
      </TableCell>
    </TableRow>
  );
}

export default function DepartmentsTab({ institutionId, access }) {
  const departments = useApi(() => identityApi.listDepartments(institutionId), [institutionId]);
  const manages = can(access, "structure.manage") && access.scope.all;
  const [form, setForm] = useState({ name: "", code: "" });
  const [saving, setSaving] = useState(false);

  const create = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const d = await identityApi.createDepartment(institutionId, form);
      departments.setData((rows) => byName([...(rows ?? []), d]));
      setForm({ name: "", code: "" });
      toast.success(`${d.name} added.`);
    } catch (err) {
      toast.error(err.fieldErrors?.name ?? err.message);
    } finally {
      setSaving(false);
    }
  };

  const rows = departments.data ?? [];
  return (
    <div className="space-y-4">
      {manages ? (
        <Card className="p-5">
          <h2 className="text-sm font-semibold">Add a department</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Departments group batches. A department head sees and manages the batches in their departments.
          </p>
          <form onSubmit={create} className="mt-4 grid max-w-xl gap-3 sm:grid-cols-[1fr_120px_auto] sm:items-end">
            <Field label="Name" htmlFor="d-name">
              <Input id="d-name" placeholder="Computer Science" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </Field>
            <Field label="Code" htmlFor="d-code">
              <Input id="d-code" placeholder="CSE" value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} />
            </Field>
            <Button type="submit" disabled={saving || !form.name.trim()}>
              {saving ? <Spinner /> : null}
              Add
            </Button>
          </form>
        </Card>
      ) : null}
      <Card className="overflow-hidden">
        {departments.loading ? (
          <div className="p-5">
            <Skeleton className="h-5 w-1/3" />
          </div>
        ) : departments.error ? (
          <EmptyState title="Couldn't load departments" description={departments.error.message} />
        ) : rows.length === 0 ? (
          <EmptyState icon={<Building />} title="No departments yet" description="Small institutions can skip departments and use batches only." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Department</TableHead>
                <TableHead>Code</TableHead>
                <TableHead>Batches</TableHead>
                <TableHead className="w-20">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((d) => (
                <Row
                  key={d.id}
                  department={d}
                  institutionId={institutionId}
                  manages={manages}
                  onSaved={(u) => departments.setData((list) => byName(list.map((x) => (x.id === u.id ? u : x))))}
                  onDeleted={(id) => departments.setData((list) => list.filter((x) => x.id !== id))}
                />
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
