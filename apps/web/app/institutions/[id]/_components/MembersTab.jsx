"use client";
import { useState } from "react";
import toast from "react-hot-toast";
import { Copy, KeyRound, Pencil, Trash2, Upload, Users, X } from "lucide-react";
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
} from "@logixai/ui";
import { identityApi } from "@/app/lib/api/identity";
import { useApi } from "@/app/lib/api/useApi";
import { usePagedApi } from "@/app/lib/api/usePagedApi";
import LoadMore from "@/app/components/LoadMore";
import { ROLE_LABEL, ROLE_SENIORITY, ROLE_TONE, can, formatDate, grantableRoles } from "../../labels";
import ImportPanel from "./ImportPanel";

/** Can the caller act on this member at all? Mirrors identity-service: owners on anyone, others on juniors. */
const actsOn = (access, member) =>
  can(access, "people.manage") && (access.role === "owner" || ROLE_SENIORITY[member.role] < ROLE_SENIORITY[access.role]);

const NO_DEPARTMENT = "__none";

function TempPasswordNotice({ notice, institution, onClose }) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(notice.tempPassword);
      toast.success("Password copied.");
    } catch {
      toast.error("Couldn't copy. Select it and copy instead.");
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-warning/30 bg-warning-soft px-4 py-3 text-sm">
      <KeyRound className="size-4 shrink-0 text-warning" />
      <span className="flex-1">
        New temporary password for <span className="font-semibold">{notice.name}</span>:{" "}
        <span className="font-mono font-semibold">{notice.tempPassword}</span>. They sign in
        {notice.rollNumber ? (
          <>
            {" "}with institution code <span className="font-mono">{institution.slug}</span> and roll number{" "}
            <span className="font-mono">{notice.rollNumber}</span>
          </>
        ) : null}{" "}
        and then choose their own. It isn&apos;t shown again.
      </span>
      <Button size="sm" variant="ghost" onClick={copy}>
        <Copy />
        Copy
      </Button>
      <Button size="icon-sm" variant="ghost" aria-label="Dismiss" onClick={onClose}>
        <X />
      </Button>
    </div>
  );
}

export default function MembersTab({ institution, access, myUserId }) {
  const institutionId = institution.id;
  const myRole = access.role;
  const [importing, setImporting] = useState(false);
  const [imported, setImported] = useState(false);
  const [resetNotice, setResetNotice] = useState(null);
  const managesPeople = can(access, "people.manage");
  const members = usePagedApi(
    (cursor) => identityApi.listMembers(institutionId, { cursor }),
    [institutionId],
  );
  const batches = useApi(() => identityApi.listBatches(institutionId), [institutionId]);
  const batchName = new Map((batches.data ?? []).map((b) => [b.id, b.name]));
  const departments = useApi(() => identityApi.listDepartments(institutionId), [institutionId], {
    enabled: Boolean(access.scope?.all),
  });
  const deptName = new Map((departments.data ?? []).map((d) => [d.id, d.name]));

  const changeDepartment = async (member, departmentId) => {
    try {
      const updated = await identityApi.updateMember(institutionId, member.userId, {
        departmentIds: departmentId === NO_DEPARTMENT ? [] : [departmentId],
      });
      members.setItems((rows) => rows.map((r) => (r.userId === updated.userId ? updated : r)));
      toast.success(`Updated ${member.name}'s department.`);
    } catch (err) {
      toast.error(err.message);
    }
  };

  const changeRole = async (member, role) => {
    try {
      const updated = await identityApi.updateMember(institutionId, member.userId, { role });
      members.setItems((rows) => rows.map((r) => (r.userId === updated.userId ? updated : r)));
      toast.success(`${member.name} is now ${ROLE_LABEL[role].toLowerCase()}.`);
    } catch (err) {
      toast.error(err.message);
    }
  };

  const editRollNumber = async (member) => {
    const value = window.prompt(`Roll number for ${member.name} (leave empty to remove)`, member.rollNumber ?? "");
    if (value === null) return;
    try {
      const updated = await identityApi.updateMember(institutionId, member.userId, { rollNumber: value.trim() || null });
      members.setItems((rows) => rows.map((r) => (r.userId === updated.userId ? updated : r)));
      toast.success(updated.rollNumber ? `Roll number set to ${updated.rollNumber}.` : "Roll number removed.");
    } catch (err) {
      toast.error(err.fieldErrors?.rollNumber ?? err.message);
    }
  };

  const resetPassword = async (member) => {
    if (!window.confirm(`Give ${member.name} a new temporary password? They'll be signed out everywhere.`)) return;
    try {
      const { tempPassword } = await identityApi.resetPassword(institutionId, member.userId);
      setResetNotice({ name: member.name, rollNumber: member.rollNumber, tempPassword });
    } catch (err) {
      toast.error(err.message);
    }
  };

  const remove = async (member) => {
    if (!window.confirm(`Remove ${member.name} from this institution?`)) return;
    try {
      await identityApi.removeMember(institutionId, member.userId);
      members.setItems((rows) => rows.filter((r) => r.userId !== member.userId));
      toast.success(`${member.name} was removed.`);
    } catch (err) {
      toast.error(err.message);
    }
  };

  if (members.loading) {
    return (
      <Card className="space-y-3 p-5">
        <Skeleton className="h-5 w-1/2" />
        <Skeleton className="h-5 w-1/3" />
      </Card>
    );
  }
  if (members.error) {
    return (
      <Card>
        <EmptyState title="Couldn't load members" description={members.error.message} />
      </Card>
    );
  }

  const rows = members.items;

  return (
    <div className="space-y-4">
      {managesPeople ? (
        importing ? (
          batches.data ? (
            <ImportPanel
              institution={institution}
              access={access}
              batches={batches.data}
              onClose={() => {
                setImporting(false);
                // Reload after closing: reloading now would replace the panel (and its passwords) with a spinner.
                if (imported) members.reload();
                setImported(false);
              }}
              onImported={() => {
                setImported(true);
                batches.reload();
              }}
            />
          ) : null
        ) : (
          <div className="flex justify-end">
            <Button size="sm" variant="outline" onClick={() => setImporting(true)}>
              <Upload />
              Import students
            </Button>
          </div>
        )
      ) : null}
      {resetNotice ? <TempPasswordNotice notice={resetNotice} institution={institution} onClose={() => setResetNotice(null)} /> : null}
    <Card className="overflow-hidden">
      {rows.length <= 1 ? (
        <EmptyState
          icon={<Users />}
          title="Invite your instructors and students"
          description={
            managesPeople
              ? "Import a class list, or create an invite code in the Invites tab and share it."
              : "Admins can invite people from the Invites tab."
          }
        />
      ) : null}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Member</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Roll number</TableHead>
            <TableHead>Batches</TableHead>
            <TableHead>Joined</TableHead>
            <TableHead className="w-20">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((member) => {
            const editable = member.userId !== myUserId && actsOn(access, member);
            const roles = editable ? [...new Set([member.role, ...grantableRoles(myRole)])] : [];
            const removable = editable;
            return (
              <TableRow key={member.userId}>
                <TableCell>
                  <div className="flex items-center gap-3">
                    <Avatar name={member.name} size="sm" />
                    <div className="min-w-0">
                      <p className="truncate font-medium">
                        {member.name}
                        {member.userId === myUserId ? (
                          <span className="font-normal text-muted-foreground"> (you)</span>
                        ) : null}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {member.email || "No email · roll-number sign-in"}
                      </p>
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  {roles.length ? (
                    <Select value={member.role} onValueChange={(role) => changeRole(member, role)}>
                      <SelectTrigger size="sm" className="w-44" aria-label={`Role for ${member.name}`}>
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
                  ) : (
                    <Badge tone={ROLE_TONE[member.role]}>{ROLE_LABEL[member.role]}</Badge>
                  )}
                  {member.role === "dept_head" ? (
                    access.scope?.all && departments.data ? (
                      <Select
                        value={member.departmentIds?.[0] ?? NO_DEPARTMENT}
                        onValueChange={(d) => changeDepartment(member, d)}
                      >
                        <SelectTrigger size="sm" className="mt-1.5 w-44" aria-label={`Department for ${member.name}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NO_DEPARTMENT}>No department</SelectItem>
                          {departments.data.map((d) => (
                            <SelectItem key={d.id} value={d.id}>
                              {d.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {(member.departmentIds ?? []).map((d) => deptName.get(d) ?? "Department").join(", ") || "No department"}
                      </p>
                    )
                  ) : null}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1">
                    <span className="font-mono text-xs">{member.rollNumber ?? <span className="text-muted-foreground">—</span>}</span>
                    {member.role === "student" && (editable || (managesPeople && member.userId !== myUserId && actsOn(access, member))) ? (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        title="Edit roll number"
                        aria-label={`Edit roll number for ${member.name}`}
                        onClick={() => editRollNumber(member)}
                      >
                        <Pencil />
                      </Button>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {member.batchIds.length
                      ? member.batchIds.map((b) => (
                          <Badge key={b} tone="outline">
                            {batchName.get(b) ?? "Batch"}
                          </Badge>
                        ))
                      : <span className="text-muted-foreground">—</span>}
                  </div>
                </TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {formatDate(member.joinedAt)}
                </TableCell>
                <TableCell>
                  <div className="flex justify-end gap-1">
                    {editable && member.managed ? (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        title="New temporary password"
                        aria-label={`New temporary password for ${member.name}`}
                        onClick={() => resetPassword(member)}
                      >
                        <KeyRound />
                      </Button>
                    ) : null}
                    {removable ? (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        title="Remove"
                        aria-label={`Remove ${member.name}`}
                        onClick={() => remove(member)}
                      >
                        <Trash2 />
                      </Button>
                    ) : null}
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <LoadMore list={members} />
    </Card>
    </div>
  );
}
