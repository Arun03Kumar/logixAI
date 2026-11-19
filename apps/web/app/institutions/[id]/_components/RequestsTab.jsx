"use client";
import { useState } from "react";
import toast from "react-hot-toast";
import { Check, Inbox, X } from "lucide-react";
import {
  Avatar,
  Badge,
  Button,
  Card,
  EmptyState,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
} from "@logixai/ui";
import { identityApi } from "@/app/lib/api/identity";
import { useApi } from "@/app/lib/api/useApi";
import { ROLE_LABEL, formatDate, inScope } from "../../labels";

const SOURCE_LABEL = { invite: "Invite", domain: "Email domain" };
const NO_BATCH = "__none";

/**
 * People waiting to join: from invites that need approval, and people with
 * the institution's email domain. Approving one without a batch asks where
 * to put them.
 */
export default function RequestsTab({ institutionId, access }) {
  const [status, setStatus] = useState("pending");
  const requests = useApi(() => identityApi.listJoinRequests(institutionId, status), [institutionId, status]);
  const batches = useApi(() => identityApi.listBatches(institutionId), [institutionId]);
  const batchName = new Map((batches.data ?? []).map((b) => [b.id, b.name]));
  const usable = (batches.data ?? []).filter((b) => !b.archived && inScope(access, b.id));
  const [chosen, setChosen] = useState({});
  const [busy, setBusy] = useState(null);

  const decide = async (r, approve) => {
    const picked = chosen[r.id] ?? (access.scope.all ? NO_BATCH : usable[0]?.id);
    const batchId = r.batchId ? undefined : picked && picked !== NO_BATCH ? picked : null;
    if (!approve && !window.confirm(`Turn down ${r.name}'s request?`)) return;
    setBusy(r.id);
    try {
      await identityApi.decideJoinRequest(institutionId, r.id, { approve, ...(batchId !== undefined ? { batchId } : {}) });
      requests.setData((rows) => (rows ?? []).filter((x) => x.id !== r.id));
      toast.success(approve ? `${r.name} joined.` : `${r.name}'s request was turned down.`);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(null);
    }
  };

  const rows = requests.data ?? [];
  const pending = status === "pending";

  return (
    <div className="space-y-4">
      <Tabs
        size="sm"
        aria-label="Requests"
        items={[
          { value: "pending", label: "Waiting" },
          { value: "approved", label: "Approved" },
          { value: "rejected", label: "Turned down" },
        ]}
        value={status}
        onValueChange={setStatus}
      />
      <Card className="overflow-hidden">
        {requests.loading ? (
          <div className="p-5">
            <Skeleton className="h-5 w-1/3" />
          </div>
        ) : requests.error ? (
          <EmptyState title="Couldn't load requests" description={requests.error.message} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<Inbox />}
            title={pending ? "Nobody is waiting" : "Nothing here yet"}
            description={
              pending
                ? "When you create an invite that needs approval, people who use it wait here until you let them in."
                : "Decided requests appear here."
            }
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Person</TableHead>
                <TableHead>Joining as</TableHead>
                <TableHead>Roll number</TableHead>
                <TableHead>Batch</TableHead>
                <TableHead>Via</TableHead>
                <TableHead>{pending ? "Asked" : "Decided"}</TableHead>
                {pending ? (
                  <TableHead className="w-48">
                    <span className="sr-only">Decision</span>
                  </TableHead>
                ) : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Avatar name={r.name} size="sm" />
                      <div className="min-w-0">
                        <p className="truncate font-medium">{r.name}</p>
                        <p className="truncate text-xs text-muted-foreground">{r.email}</p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>{ROLE_LABEL[r.role]}</TableCell>
                  <TableCell className="font-mono text-xs">{r.rollNumber ?? "—"}</TableCell>
                  <TableCell>
                    {r.batchId ? (
                      <span className="text-muted-foreground">{batchName.get(r.batchId) ?? "Batch"}</span>
                    ) : pending ? (
                      <Select
                        value={chosen[r.id] ?? (access.scope.all ? NO_BATCH : (usable[0]?.id ?? NO_BATCH))}
                        onValueChange={(v) => setChosen((c) => ({ ...c, [r.id]: v }))}
                      >
                        <SelectTrigger size="sm" className="w-44" aria-label={`Batch for ${r.name}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {access.scope.all ? <SelectItem value={NO_BATCH}>No batch</SelectItem> : null}
                          {usable.map((b) => (
                            <SelectItem key={b.id} value={b.id}>
                              {b.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge tone="outline">{SOURCE_LABEL[r.source]}</Badge>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(r.decidedAt ?? r.createdAt)}</TableCell>
                  {pending ? (
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="primary" disabled={busy === r.id} onClick={() => decide(r, true)}>
                          <Check />
                          Approve
                        </Button>
                        <Button size="sm" variant="ghost" disabled={busy === r.id} aria-label={`Turn down ${r.name}`} onClick={() => decide(r, false)}>
                          <X />
                        </Button>
                      </div>
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
