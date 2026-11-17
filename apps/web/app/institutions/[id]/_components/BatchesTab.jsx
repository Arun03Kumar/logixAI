"use client";
import { useState } from "react";
import toast from "react-hot-toast";
import { Layers } from "lucide-react";
import {
  Button,
  Card,
  EmptyState,
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
import { canManage, formatDate } from "../../labels";

export default function BatchesTab({ institutionId, myRole }) {
  const batches = useApi(() => identityApi.listBatches(institutionId), [institutionId]);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  const create = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const batch = await identityApi.createBatch(institutionId, { name });
      batches.setData((rows) => [...(rows ?? []), batch].sort((a, b) => a.name.localeCompare(b.name)));
      setName("");
      toast.success(`Batch “${batch.name}” created.`);
    } catch (err) {
      toast.error(err.fieldErrors?.name ?? err.message);
    } finally {
      setSaving(false);
    }
  };

  const rows = batches.data ?? [];

  return (
    <div className="space-y-4">
      {canManage(myRole) ? (
        <Card className="p-5">
          <h2 className="text-sm font-semibold">Add a batch</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Batches group students (a class, section or year) so tests can be
            assigned to them.
          </p>
          <form onSubmit={create} className="mt-4 flex max-w-md gap-2">
            <Input
              aria-label="Batch name"
              placeholder="CSE 2026, Section A"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <Button type="submit" disabled={saving || !name.trim()}>
              {saving ? <Spinner /> : null}
              Add batch
            </Button>
          </form>
        </Card>
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
                <TableHead>Members</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((batch) => (
                <TableRow key={batch.id}>
                  <TableCell className="font-medium">{batch.name}</TableCell>
                  <TableCell className="text-muted-foreground">{batch.memberCount}</TableCell>
                  <TableCell className="text-muted-foreground">{formatDate(batch.createdAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
