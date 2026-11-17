"use client";
import { useState } from "react";
import toast from "react-hot-toast";
import { Copy, Ticket } from "lucide-react";
import {
  Badge,
  Button,
  Card,
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
import FormError from "@/app/components/forms/FormError";
import { identityApi } from "@/app/lib/api/identity";
import { useApi } from "@/app/lib/api/useApi";
import { ROLE_LABEL, formatDate } from "../../labels";

const NO_BATCH = "none";

function inviteStatus(invite) {
  if (invite.revoked) return { label: "Revoked", tone: "neutral" };
  if (new Date(invite.expiresAt) <= new Date()) return { label: "Expired", tone: "neutral" };
  if (invite.maxUses !== null && invite.uses >= invite.maxUses) {
    return { label: "Used up", tone: "neutral" };
  }
  return { label: "Active", tone: "success" };
}

const joinLink = (code) => `${window.location.origin}/join/${code}`;

async function copyLink(code) {
  try {
    await navigator.clipboard.writeText(joinLink(code));
    toast.success("Invite link copied.");
  } catch {
    toast.error("Couldn't copy. Select the code and copy it instead.");
  }
}

function CreateInviteForm({ institutionId, myRole, batches, onCreated }) {
  const [form, setForm] = useState({
    role: "student",
    batchId: NO_BATCH,
    maxUses: "",
    expiresInDays: "14",
  });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [saving, setSaving] = useState(false);
  const set = (field) => (value) => setForm((f) => ({ ...f, [field]: value }));

  const roles = myRole === "owner" ? ["student", "instructor", "admin"] : ["student", "instructor"];

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    setErrors({});
    try {
      const invite = await identityApi.createInvite(institutionId, {
        role: form.role,
        ...(form.batchId !== NO_BATCH ? { batchId: form.batchId } : {}),
        maxUses: form.maxUses ? Number(form.maxUses) : null,
        expiresInDays: Number(form.expiresInDays),
      });
      onCreated(invite);
      toast.success(`Invite ${invite.code} created.`);
    } catch (err) {
      setErrors(err.fieldErrors ?? {});
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="p-5">
      <h2 className="text-sm font-semibold">Create an invite</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Share the code or link. Anyone who signs in with it joins with the role
        and batch you choose.
      </p>
      <form onSubmit={submit} className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="sm:col-span-2 lg:col-span-4">
          <FormError message={formError} />
        </div>
        <Field label="Role" htmlFor="inv-role">
          <Select value={form.role} onValueChange={set("role")}>
            <SelectTrigger id="inv-role" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {roles.map((r) => (
                <SelectItem key={r} value={r}>
                  {ROLE_LABEL[r]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Batch" htmlFor="inv-batch">
          <Select value={form.batchId} onValueChange={set("batchId")}>
            <SelectTrigger id="inv-batch" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_BATCH}>No batch</SelectItem>
              {batches.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Max uses" htmlFor="inv-uses" hint="Leave empty for unlimited." error={errors.maxUses}>
          <Input
            id="inv-uses"
            type="number"
            min={1}
            placeholder="Unlimited"
            value={form.maxUses}
            onChange={(e) => set("maxUses")(e.target.value)}
          />
        </Field>
        <Field label="Expires after" htmlFor="inv-expiry">
          <Select value={form.expiresInDays} onValueChange={set("expiresInDays")}>
            <SelectTrigger id="inv-expiry" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {["7", "14", "30", "90"].map((d) => (
                <SelectItem key={d} value={d}>
                  {d} days
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <div className="sm:col-span-2 lg:col-span-4">
          <Button type="submit" variant="primary" disabled={saving}>
            {saving ? <Spinner className="text-primary-foreground" /> : null}
            Create invite
          </Button>
        </div>
      </form>
    </Card>
  );
}

export default function InvitesTab({ institutionId, myRole }) {
  const invites = useApi(() => identityApi.listInvites(institutionId), [institutionId]);
  const batches = useApi(() => identityApi.listBatches(institutionId), [institutionId]);
  const batchName = new Map((batches.data ?? []).map((b) => [b.id, b.name]));

  const revoke = async (invite) => {
    if (!window.confirm(`Revoke invite ${invite.code}? People can no longer join with it.`)) return;
    try {
      await identityApi.revokeInvite(institutionId, invite.id);
      invites.setData((rows) => rows.map((r) => (r.id === invite.id ? { ...r, revoked: true } : r)));
      toast.success("Invite revoked.");
    } catch (err) {
      toast.error(err.message);
    }
  };

  const rows = invites.data ?? [];

  return (
    <div className="space-y-4">
      <CreateInviteForm
        institutionId={institutionId}
        myRole={myRole}
        batches={batches.data ?? []}
        onCreated={(invite) => invites.setData((list) => [invite, ...(list ?? [])])}
      />
      <Card className="overflow-hidden">
        {invites.loading ? (
          <div className="p-5">
            <Skeleton className="h-5 w-1/3" />
          </div>
        ) : invites.error ? (
          <EmptyState title="Couldn't load invites" description={invites.error.message} />
        ) : rows.length === 0 ? (
          <EmptyState icon={<Ticket />} title="No invites yet" description="Invites you create appear here." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Batch</TableHead>
                <TableHead>Uses</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-24">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((invite) => {
                const status = inviteStatus(invite);
                const active = status.label === "Active";
                return (
                  <TableRow key={invite.id}>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <span className="font-mono text-sm font-medium">{invite.code}</span>
                        {active ? (
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Copy link for ${invite.code}`}
                            onClick={() => copyLink(invite.code)}
                          >
                            <Copy />
                          </Button>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell>{ROLE_LABEL[invite.role]}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {invite.batchId ? (batchName.get(invite.batchId) ?? "Batch") : "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {invite.uses} / {invite.maxUses ?? "∞"}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {formatDate(invite.expiresAt)}
                    </TableCell>
                    <TableCell>
                      <Badge tone={status.tone}>{status.label}</Badge>
                    </TableCell>
                    <TableCell>
                      {active ? (
                        <Button variant="ghost" size="sm" className="text-danger" onClick={() => revoke(invite)}>
                          Revoke
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
