import type {
  AuditAction,
  AuditEvent,
  Page,
  BatchView,
  CreateBatchInput,
  CreateInstitutionInput,
  CreateInviteInput,
  InstitutionRole,
  InstitutionSummary,
  InvitePreview,
  InviteView,
  MemberView,
  MembershipSummary,
  UpdateMemberInput,
} from "@logixai/contracts";
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "@logixai/service-kit";
import { newInviteCode } from "../lib/tokens.js";
import type {
  InstitutionRecord,
  InviteRecord,
  MembershipRecord,
  Store,
} from "../store/types.js";

const RANK: Record<InstitutionRole, number> = {
  student: 1,
  instructor: 2,
  admin: 3,
  owner: 4,
};

export function toInstitutionSummary(inst: InstitutionRecord): InstitutionSummary {
  return {
    id: inst.id,
    name: inst.name,
    slug: inst.slug,
    type: inst.type,
    createdAt: inst.createdAt.toISOString(),
  };
}

function toInviteView(invite: InviteRecord): InviteView {
  return {
    id: invite.id,
    code: invite.code,
    role: invite.role,
    batchId: invite.batchId,
    maxUses: invite.maxUses,
    uses: invite.uses,
    expiresAt: invite.expiresAt.toISOString(),
    revoked: Boolean(invite.revokedAt),
    createdAt: invite.createdAt.toISOString(),
  };
}

function inviteProblem(invite: InviteRecord): InvitePreview["reason"] | undefined {
  if (invite.revokedAt) return "revoked";
  if (invite.expiresAt.getTime() <= Date.now()) return "expired";
  if (invite.maxUses !== null && invite.uses >= invite.maxUses) return "used_up";
  return undefined;
}

const INVITE_MESSAGES: Record<NonNullable<InvitePreview["reason"]>, string> = {
  expired: "This invite has expired. Ask your institution for a new one.",
  revoked: "This invite is no longer active. Ask your institution for a new one.",
  used_up: "This invite has been used the maximum number of times.",
};

/** "IIT Delhi CSE" -> "iit-delhi-cse" */
function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "institution"
  );
}

export class InstitutionService {
  constructor(private readonly store: Store) {}

  async create(userId: string, input: CreateInstitutionInput): Promise<MembershipSummary> {
    const base = slugify(input.name);
    let slug = base;
    for (let i = 2; await this.store.institutions.slugExists(slug); i++) {
      slug = `${base}-${i}`;
    }
    const institution = await this.store.institutions.create({
      name: input.name,
      type: input.type,
      slug,
      createdBy: userId,
    });
    const membership = await this.store.memberships.create({
      userId,
      institutionId: institution.id,
      role: "owner",
      batchIds: [],
    });
    await this.audit(userId, "institution.created", institution.id, "institution", institution.id, {
      name: institution.name,
    });
    return {
      institution: toInstitutionSummary(institution),
      role: membership.role,
      batchIds: [],
      joinedAt: membership.createdAt.toISOString(),
    };
  }

  /** The institution plus the caller's own role in it. */
  async get(userId: string, institutionId: string): Promise<MembershipSummary> {
    const { institution, membership } = await this.requireRole(userId, institutionId, "student");
    return {
      institution: toInstitutionSummary(institution),
      role: membership.role,
      batchIds: membership.batchIds,
      joinedAt: membership.createdAt.toISOString(),
    };
  }

  /** One page of members, highest role first. `userIds` looks up specific people. */
  async listMembers(
    userId: string,
    institutionId: string,
    query: { limit: number; cursor?: string; role?: InstitutionRole; userIds?: string[]; batchId?: string },
  ): Promise<Page<MemberView>> {
    await this.requireRole(userId, institutionId, "instructor");
    const page = await this.store.memberships.pageForInstitution(institutionId, query);
    const users = await this.store.users.findByIds(page.items.map((m) => m.userId));
    const byId = new Map(users.map((u) => [u.id, u]));
    return {
      items: page.items
        .map((m) => ({ m, u: byId.get(m.userId) }))
        .filter((x): x is { m: MembershipRecord; u: NonNullable<typeof x.u> } => Boolean(x.u))
        .map(({ m, u }) => ({
          userId: u.id,
          name: u.name,
          email: u.email,
          role: m.role,
          batchIds: m.batchIds,
          joinedAt: m.createdAt.toISOString(),
        })),
      nextCursor: page.nextCursor,
    };
  }

  /** The institution's audit log, newest first (owners and admins). */
  async listAudit(
    userId: string,
    institutionId: string,
    query: { limit: number; cursor?: string },
  ): Promise<Page<AuditEvent>> {
    await this.requireRole(userId, institutionId, "admin");
    return this.store.audit.pageForInstitution(institutionId, query);
  }

  async updateMember(
    actorId: string,
    institutionId: string,
    targetUserId: string,
    input: UpdateMemberInput,
  ): Promise<MemberView> {
    const { membership: actor } = await this.requireRole(actorId, institutionId, "admin");
    const target = await this.store.memberships.find(targetUserId, institutionId);
    if (!target) throw new NotFoundError("Member", targetUserId);

    if (input.role && input.role !== target.role) {
      // Only owners can create or demote owners; admins can't touch other admins.
      const touchesOwner = input.role === "owner" || target.role === "owner";
      if (touchesOwner && actor.role !== "owner") {
        throw new ForbiddenError("Only an owner can change ownership.");
      }
      if (input.role === "admin" && actor.role !== "owner") {
        throw new ForbiddenError("Only an owner can make someone an admin.");
      }
      if (target.role === "admin" && actor.role !== "owner" && target.userId !== actorId) {
        throw new ForbiddenError("Only an owner can change another admin's role.");
      }
      if (target.role === "owner" && (await this.store.memberships.countByRole(institutionId, "owner")) <= 1) {
        throw new BadRequestError("role", {
          reason: "An institution needs at least one owner. Make someone else an owner first.",
        });
      }
    }

    if (input.batchIds) {
      const batches = await this.store.batches.listForInstitution(institutionId);
      const valid = new Set(batches.map((b) => b.id));
      if (input.batchIds.some((id) => !valid.has(id))) {
        throw new BadRequestError("batchIds", { reason: "Unknown batch" });
      }
    }

    const updated = await this.store.memberships.update(target.id, {
      ...(input.role ? { role: input.role } : {}),
      ...(input.batchIds ? { batchIds: [...new Set(input.batchIds)] } : {}),
    });
    const user = await this.store.users.findById(targetUserId);
    if (!updated || !user) throw new NotFoundError("Member", targetUserId);
    if (input.role && input.role !== target.role) {
      await this.audit(actorId, "member.role_changed", institutionId, "member", targetUserId, {
        from: target.role,
        to: input.role,
      });
    }
    if (input.batchIds) {
      await this.audit(actorId, "member.batches_changed", institutionId, "member", targetUserId, {
        batchIds: updated.batchIds,
      });
    }
    return {
      userId: user.id,
      name: user.name,
      email: user.email,
      role: updated.role,
      batchIds: updated.batchIds,
      joinedAt: updated.createdAt.toISOString(),
    };
  }

  /** Admins remove others; anyone can leave. The last owner can't leave. */
  async removeMember(actorId: string, institutionId: string, targetUserId: string): Promise<void> {
    const leaving = actorId === targetUserId;
    const { membership: actor } = await this.requireRole(
      actorId,
      institutionId,
      leaving ? "student" : "admin",
    );
    const target = leaving ? actor : await this.store.memberships.find(targetUserId, institutionId);
    if (!target) throw new NotFoundError("Member", targetUserId);
    if (!leaving && RANK[target.role] >= RANK[actor.role] && actor.role !== "owner") {
      throw new ForbiddenError("You can't remove someone with the same or a higher role.");
    }
    if (target.role === "owner" && (await this.store.memberships.countByRole(institutionId, "owner")) <= 1) {
      throw new BadRequestError("member", {
        reason: "An institution needs at least one owner.",
      });
    }
    await this.store.memberships.delete(target.id);
    await this.audit(actorId, "member.removed", institutionId, "member", target.userId, {
      role: target.role,
      left: leaving,
    });
  }

  async createBatch(userId: string, institutionId: string, input: CreateBatchInput): Promise<BatchView> {
    await this.requireRole(userId, institutionId, "admin");
    if (await this.store.batches.findByName(institutionId, input.name)) {
      throw new ConflictError("A batch with this name already exists.");
    }
    const batch = await this.store.batches.create({ institutionId, name: input.name });
    await this.audit(userId, "batch.created", institutionId, "batch", batch.id, { name: batch.name });
    return { id: batch.id, name: batch.name, memberCount: 0, createdAt: batch.createdAt.toISOString() };
  }

  async listBatches(userId: string, institutionId: string): Promise<BatchView[]> {
    await this.requireRole(userId, institutionId, "instructor");
    const [batches, counts] = await Promise.all([
      this.store.batches.listForInstitution(institutionId),
      this.store.memberships.countByBatch(institutionId),
    ]);
    return batches.map((b) => ({
      id: b.id,
      name: b.name,
      memberCount: counts[b.id] ?? 0,
      createdAt: b.createdAt.toISOString(),
    }));
  }

  async createInvite(userId: string, institutionId: string, input: CreateInviteInput): Promise<InviteView> {
    const { membership } = await this.requireRole(userId, institutionId, "admin");
    if (input.role === "admin" && membership.role !== "owner") {
      throw new ForbiddenError("Only an owner can invite admins.");
    }
    if (input.batchId) {
      const batch = await this.store.batches.findById(input.batchId);
      if (!batch || batch.institutionId !== institutionId) {
        throw new BadRequestError("batchId", { reason: "Unknown batch" });
      }
    }
    const invite = await this.store.invites.create({
      institutionId,
      code: newInviteCode(),
      role: input.role,
      batchId: input.batchId ?? null,
      maxUses: input.maxUses,
      uses: 0,
      expiresAt: new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000),
      revokedAt: null,
      createdBy: userId,
    });
    await this.audit(userId, "invite.created", institutionId, "invite", invite.id, {
      role: invite.role,
      batchId: invite.batchId,
      maxUses: invite.maxUses,
    });
    return toInviteView(invite);
  }

  async listInvites(userId: string, institutionId: string): Promise<InviteView[]> {
    await this.requireRole(userId, institutionId, "admin");
    return (await this.store.invites.listForInstitution(institutionId)).map(toInviteView);
  }

  async revokeInvite(userId: string, institutionId: string, inviteId: string): Promise<void> {
    await this.requireRole(userId, institutionId, "admin");
    const invite = await this.store.invites.findById(inviteId);
    if (!invite || invite.institutionId !== institutionId) {
      throw new NotFoundError("Invite", inviteId);
    }
    await this.store.invites.revoke(invite.id);
    await this.audit(userId, "invite.revoked", institutionId, "invite", invite.id, { code: invite.code });
  }

  async previewInvite(code: string): Promise<InvitePreview> {
    const invite = await this.store.invites.findByCode(code.toUpperCase());
    if (!invite) throw new NotFoundError("Invite", code);
    const institution = await this.store.institutions.findById(invite.institutionId);
    if (!institution) throw new NotFoundError("Invite", code);
    const batch = invite.batchId ? await this.store.batches.findById(invite.batchId) : null;
    const reason = inviteProblem(invite);
    return {
      code: invite.code,
      institution: { name: institution.name, type: institution.type },
      role: invite.role,
      batchName: batch?.name ?? null,
      valid: !reason,
      ...(reason ? { reason } : {}),
    };
  }

  /** Joins the institution (or adds the batch if already a member). */
  async acceptInvite(userId: string, code: string): Promise<MembershipSummary> {
    const invite = await this.store.invites.findByCode(code.toUpperCase());
    if (!invite) throw new NotFoundError("Invite", code);
    const reason = inviteProblem(invite);
    if (reason) throw new BadRequestError("invite", { reason: INVITE_MESSAGES[reason] });

    const institution = await this.store.institutions.findById(invite.institutionId);
    if (!institution) throw new NotFoundError("Invite", code);

    let membership = await this.store.memberships.find(userId, institution.id);
    if (!membership) {
      if (!(await this.store.invites.consumeUse(invite.id))) {
        throw new BadRequestError("invite", { reason: INVITE_MESSAGES.used_up });
      }
      membership = await this.store.memberships.create({
        userId,
        institutionId: institution.id,
        role: invite.role,
        batchIds: invite.batchId ? [invite.batchId] : [],
      });
      await this.audit(userId, "member.joined", institution.id, "member", userId, {
        role: invite.role,
        inviteId: invite.id,
      });
    } else if (invite.batchId && !membership.batchIds.includes(invite.batchId)) {
      // Existing members keep their role; the invite only adds the batch.
      await this.store.memberships.addBatch(membership.id, invite.batchId);
      membership = { ...membership, batchIds: [...membership.batchIds, invite.batchId] };
    }

    return {
      institution: toInstitutionSummary(institution),
      role: membership.role,
      batchIds: membership.batchIds,
      joinedAt: membership.createdAt.toISOString(),
    };
  }

  /** Audit records must never block the action itself. */
  private async audit(
    actorId: string,
    action: AuditAction,
    institutionId: string,
    targetType: AuditEvent["targetType"],
    targetId: string,
    meta: Record<string, unknown> = {},
  ) {
    await this.store.audit
      .record({ actorId, action, institutionId, targetType, targetId, meta })
      .catch(() => {});
  }

  private async requireRole(userId: string, institutionId: string, minimum: InstitutionRole) {
    const institution = await this.store.institutions.findById(institutionId);
    const membership = institution
      ? await this.store.memberships.find(userId, institutionId)
      : null;
    // Same 404 for "doesn't exist" and "not a member": don't reveal institutions.
    if (!institution || !membership) throw new NotFoundError("Institution", institutionId);
    if (RANK[membership.role] < RANK[minimum]) throw new ForbiddenError();
    return { institution, membership };
  }
}
