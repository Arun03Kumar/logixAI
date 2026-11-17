"use client";
import toast from "react-hot-toast";
import { Trash2, Users } from "lucide-react";
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
import { ROLE_LABEL, ROLE_TONE, canManage, formatDate } from "../../labels";

/** Roles the current user may assign, mirroring identity-service's rules. */
function assignableRoles(myRole, member) {
  if (myRole === "owner") return ["owner", "admin", "instructor", "student"];
  if (myRole === "admin" && member.role !== "owner" && member.role !== "admin") {
    return ["instructor", "student"];
  }
  return [];
}

export default function MembersTab({ institutionId, myRole, myUserId }) {
  const members = useApi(() => identityApi.listMembers(institutionId), [institutionId]);
  const batches = useApi(() => identityApi.listBatches(institutionId), [institutionId]);
  const batchName = new Map((batches.data ?? []).map((b) => [b.id, b.name]));

  const changeRole = async (member, role) => {
    try {
      const updated = await identityApi.updateMember(institutionId, member.userId, { role });
      members.setData((rows) => rows.map((r) => (r.userId === updated.userId ? updated : r)));
      toast.success(`${member.name} is now ${ROLE_LABEL[role].toLowerCase()}.`);
    } catch (err) {
      toast.error(err.message);
    }
  };

  const remove = async (member) => {
    if (!window.confirm(`Remove ${member.name} from this institution?`)) return;
    try {
      await identityApi.removeMember(institutionId, member.userId);
      members.setData((rows) => rows.filter((r) => r.userId !== member.userId));
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

  const rows = members.data ?? [];

  return (
    <Card className="overflow-hidden">
      {rows.length <= 1 ? (
        <EmptyState
          icon={<Users />}
          title="Invite your instructors and students"
          description={
            canManage(myRole)
              ? "Create an invite code in the Invites tab and share it."
              : "Admins can invite people from the Invites tab."
          }
        />
      ) : null}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Member</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Batches</TableHead>
            <TableHead>Joined</TableHead>
            <TableHead className="w-10">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((member) => {
            const roles = member.userId === myUserId ? [] : assignableRoles(myRole, member);
            const removable =
              member.userId !== myUserId &&
              canManage(myRole) &&
              (myRole === "owner" || (member.role !== "owner" && member.role !== "admin"));
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
                      <p className="truncate text-xs text-muted-foreground">{member.email}</p>
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  {roles.length ? (
                    <Select value={member.role} onValueChange={(role) => changeRole(member, role)}>
                      <SelectTrigger size="sm" className="w-32" aria-label={`Role for ${member.name}`}>
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
                  {removable ? (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Remove ${member.name}`}
                      onClick={() => remove(member)}
                    >
                      <Trash2 />
                    </Button>
                  ) : null}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Card>
  );
}
