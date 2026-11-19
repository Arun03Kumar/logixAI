import {
  ROLE_SENIORITY,
  capabilitiesFor,
  can,
  featuresWithDefaults,
  hasInstitutionWideScope,
  type AccessScope,
  type AuditAction,
  type AuditEvent,
  type BatchView,
  type Capability,
  type CreateBatchInput,
  type CreateDepartmentInput,
  type CreateInstitutionInput,
  type CreateInviteInput,
  type DepartmentView,
  type InstitutionAccess,
  type InstitutionRole,
  type InstitutionSummary,
  type InvitePreview,
  type InviteView,
  type MemberView,
  type MembershipSummary,
  type Page,
  type UpdateBatchInput,
  type UpdateMemberInput,
} from "@logixai/contracts";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "@logixai/service-kit";
import { newInviteCode } from "../lib/tokens.js";
import type {
  BatchRecord,
  DepartmentRecord,
  InstitutionRecord,
  InviteRecord,
  MembershipRecord,
  Store,
  UserRecord,
} from "../store/types.js";

export function toInstitutionSummary(inst: InstitutionRecord): InstitutionSummary {
  return {
    id: inst.id,
    name: inst.name,
    slug: inst.slug,
    type: inst.type,
    status: inst.status ?? "active",
    features: featuresWithDefaults(inst.features, inst.type),
    createdAt: inst.createdAt.toISOString(),
  };
}

export const toMembershipSummary = (
  institution: InstitutionRecord,
  m: Pick<MembershipRecord, "role" | "batchIds" | "departmentIds" | "createdAt">,
  access?: InstitutionAccess,
): MembershipSummary => ({
  institution: toInstitutionSummary(institution),
  role: m.role,
  batchIds: m.batchIds,
  departmentIds: m.departmentIds ?? [],
  joinedAt: m.createdAt.toISOString(),
  ...(access ? { access } : {}),
});

export const toMemberView = (m: MembershipRecord, u: UserRecord): MemberView => ({
  userId: u.id,
  name: u.name,
  email: u.email ?? "",
  role: m.role,
  batchIds: m.batchIds,
  departmentIds: m.departmentIds ?? [],
  rollNumber: m.rollNumber ?? null,
  managed: u.managedBy === m.institutionId,
  joinedAt: m.createdAt.toISOString(),
});

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
    requiresApproval: Boolean(invite.requiresApproval),
    createdAt: invite.createdAt.toISOString(),
  };
}

export const toBatchView = (b: BatchRecord, memberCount: number): BatchView => ({
  id: b.id,
  name: b.name,
  departmentId: b.departmentId ?? null,
  academicYear: b.academicYear ?? null,
  archived: Boolean(b.archivedAt),
  memberCount,
  createdAt: b.createdAt.toISOString(),
});

export function inviteProblem(invite: InviteRecord): InvitePreview["reason"] | undefined {
  if (invite.revokedAt) return "revoked";
  if (invite.expiresAt.getTime() <= Date.now()) return "expired";
  if (invite.maxUses !== null && invite.uses >= invite.maxUses) return "used_up";
  return undefined;
}

export const INVITE_MESSAGES: Record<NonNullable<InvitePreview["reason"]>, string> = {
  expired: "This invite has expired. Ask your institution for a new one.",
  revoked: "This invite is no longer active. Ask your institution for a new one.",
  used_up: "This invite has been used the maximum number of times.",
};

/** "IIT Delhi CSE" -> "iit-delhi-cse" */
export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "institution"
  );
}

/** The caller's resolved place in an institution. */
export interface Access {
  institution: InstitutionRecord;
  membership: MembershipRecord;
  scope: AccessScope;
  /** A LogixAI platform admin without a membership, here for support. */
  support: boolean;
  view: InstitutionAccess;
}

/** At most one support-access audit entry per admin per institution per hour. */
const SUPPORT_AUDIT_EVERY_MS = 60 * 60 * 1000;

export class InstitutionService {
  private readonly supportSeen = new Map<string, number>();

  constructor(private readonly store: Store) {}

  /* ── Access ── */

  /**
   * Resolves the caller's role, capabilities and scope. Platform admins who
   * aren't members get owner-level support access, recorded in the
   * institution's audit log. Suspended or archived institutions are closed to
   * their members (support access still works, to fix things).
   */
  async access(userId: string, institutionId: string, capability?: Capability): Promise<Access> {
    const institution = await this.store.institutions.findById(institutionId);
    // Same 404 for "doesn't exist" and "not a member": don't reveal institutions.
    if (!institution) throw new NotFoundError("Institution", institutionId);
    let membership = await this.store.memberships.find(userId, institutionId);
    let support = false;
    if (!membership) {
      const user = await this.store.users.findById(userId);
      if (user?.role !== "admin") throw new NotFoundError("Institution", institutionId);
      support = true;
      membership = { id: "support", userId, institutionId, role: "owner", batchIds: [], departmentIds: [], createdAt: new Date() };
      await this.recordSupportAccess(userId, institutionId);
    }
    const status = institution.status ?? "active";
    if (status !== "active" && !support) {
      throw new ForbiddenError(
        status === "suspended"
          ? "This institution is suspended. Contact LogixAI to restore access."
          : "This institution has been archived.",
      );
    }
    if (capability && !can(membership.role, capability)) throw new ForbiddenError();
    const scope = await this.scopeFor(membership);
    return {
      institution,
      membership,
      scope,
      support,
      view: { role: membership.role, capabilities: capabilitiesFor(membership.role), scope, support },
    };
  }

  private async scopeFor(m: MembershipRecord): Promise<AccessScope> {
    const departmentIds = m.departmentIds ?? [];
    if (hasInstitutionWideScope(m.role)) return { all: true, batchIds: [], departmentIds: [] };
    if (m.role === "dept_head") {
      const batches = await this.store.batches.listForInstitution(m.institutionId);
      const inDepartments = batches.filter((b) => b.departmentId && departmentIds.includes(b.departmentId)).map((b) => b.id);
      return { all: false, batchIds: [...new Set([...inDepartments, ...m.batchIds])], departmentIds };
    }
    return { all: false, batchIds: m.batchIds, departmentIds };
  }

  private inScope(scope: AccessScope, batchIds: string[]) {
    return scope.all || batchIds.every((b) => scope.batchIds.includes(b));
  }

  private async recordSupportAccess(adminId: string, institutionId: string) {
    const key = `${adminId}|${institutionId}`;
    const last = this.supportSeen.get(key) ?? 0;
    if (Date.now() - last < SUPPORT_AUDIT_EVERY_MS) return;
    this.supportSeen.set(key, Date.now());
    if (this.supportSeen.size > 10_000) this.supportSeen.clear();
    await this.audit(adminId, "institution.support_access", institutionId, "institution", institutionId, {});
  }

  /* ── Institution ── */

  /** Creates an institution with the caller as owner. Platform admins only (checked by the route). */
  async create(userId: string, input: CreateInstitutionInput): Promise<MembershipSummary> {
    const institution = await this.createRecord(userId, input.name, input.type);
    const membership = await this.store.memberships.create({
      userId,
      institutionId: institution.id,
      role: "owner",
      batchIds: [],
      departmentIds: [],
    });
    return toMembershipSummary(institution, membership);
  }

  async createRecord(actorId: string, name: string, type: InstitutionRecord["type"]): Promise<InstitutionRecord> {
    const base = slugify(name);
    let slug = base;
    for (let i = 2; await this.store.institutions.slugExists(slug); i++) slug = `${base}-${i}`;
    const institution = await this.store.institutions.create({
      name,
      type,
      slug,
      createdBy: actorId,
      status: "active",
      features: {},
      contract: null,
    });
    await this.audit(actorId, "institution.created", institution.id, "institution", institution.id, { name });
    return institution;
  }

  /** The institution plus the caller's role, capabilities and scope. */
  async get(userId: string, institutionId: string): Promise<MembershipSummary> {
    const a = await this.access(userId, institutionId);
    return toMembershipSummary(a.institution, a.membership, a.view);
  }

  /* ── Members ── */

  /**
   * One page of members, highest role first. Staff limited to some batches
   * see only members of those batches; `userIds` looks people up by id (used
   * by other services to show names on results).
   */
  async listMembers(
    userId: string,
    institutionId: string,
    query: { limit: number; cursor?: string; role?: InstitutionRole; userIds?: string[]; batchId?: string },
  ): Promise<Page<MemberView>> {
    const a = await this.access(userId, institutionId, "reports.view");
    const scoped = { ...query } as typeof query & { batchIds?: string[] };
    if (!a.scope.all && !query.userIds) {
      if (query.batchId && !a.scope.batchIds.includes(query.batchId)) throw new ForbiddenError("That batch isn't yours.");
      if (!query.batchId) scoped.batchIds = a.scope.batchIds;
    }
    const page = await this.store.memberships.pageForInstitution(institutionId, scoped);
    const users = await this.store.users.findByIds(page.items.map((m) => m.userId));
    const byId = new Map(users.map((u) => [u.id, u]));
    return {
      items: page.items
        .map((m) => ({ m, u: byId.get(m.userId) }))
        .filter((x): x is { m: MembershipRecord; u: NonNullable<typeof x.u> } => Boolean(x.u))
        .map(({ m, u }) => toMemberView(m, u)),
      nextCursor: page.nextCursor,
    };
  }

  /** The institution's audit log, newest first (owners and admins). */
  async listAudit(userId: string, institutionId: string, query: { limit: number; cursor?: string }): Promise<Page<AuditEvent>> {
    await this.access(userId, institutionId, "audit.view");
    return this.store.audit.pageForInstitution(institutionId, query);
  }

  /** Nobody acts on someone more senior than them; owners can act on owners. */
  assertSenior(actor: MembershipRecord, target: MembershipRecord) {
    if (actor.role === "owner") return;
    if (ROLE_SENIORITY[target.role] >= ROLE_SENIORITY[actor.role] && target.userId !== actor.userId) {
      throw new ForbiddenError("You can't change someone with the same or a more senior role.");
    }
  }

  async updateMember(actorId: string, institutionId: string, targetUserId: string, input: UpdateMemberInput): Promise<MemberView> {
    const a = await this.access(actorId, institutionId, "people.manage");
    const actor = a.membership;
    const target = await this.store.memberships.find(targetUserId, institutionId);
    if (!target) throw new NotFoundError("Member", targetUserId);
    if (!a.scope.all && !target.batchIds.some((b) => a.scope.batchIds.includes(b))) {
      throw new ForbiddenError("That member isn't in your batches.");
    }

    if (input.role && input.role !== target.role) {
      this.assertSenior(actor, target);
      const touchesOwner = input.role === "owner" || target.role === "owner";
      if (touchesOwner && actor.role !== "owner") throw new ForbiddenError("Only an owner can change ownership.");
      if (actor.role !== "owner" && ROLE_SENIORITY[input.role] >= ROLE_SENIORITY[actor.role]) {
        throw new ForbiddenError("You can only give roles below your own.");
      }
      if (target.role === "owner" && (await this.store.memberships.countByRole(institutionId, "owner")) <= 1) {
        throw new BadRequestError("role", { reason: "An institution needs at least one owner. Make someone else an owner first." });
      }
    }

    if (input.batchIds) {
      const batches = await this.store.batches.listForInstitution(institutionId);
      const valid = new Set(batches.map((b) => b.id));
      if (input.batchIds.some((id) => !valid.has(id))) throw new BadRequestError("batchIds", { reason: "Unknown batch" });
      // Scoped staff can only move people between their own batches, and must keep batches they don't manage.
      if (!a.scope.all) {
        const outside = (ids: string[]) => ids.filter((b) => !a.scope.batchIds.includes(b));
        const kept = outside(target.batchIds);
        if (outside(input.batchIds).some((b) => !kept.includes(b)) || kept.some((b) => !input.batchIds!.includes(b))) {
          throw new ForbiddenError("You can only change batches you manage.");
        }
      }
    }

    if (input.departmentIds) {
      if (!a.scope.all) throw new ForbiddenError("Only owners and admins assign departments.");
      const departments = await this.store.departments.listForInstitution(institutionId);
      const valid = new Set(departments.map((d) => d.id));
      if (input.departmentIds.some((id) => !valid.has(id))) {
        throw new BadRequestError("departmentIds", { reason: "Unknown department" });
      }
    }

    if (input.rollNumber) {
      const holder = await this.store.memberships.findByRollNumber(institutionId, input.rollNumber);
      if (holder && holder.userId !== targetUserId) throw new ConflictError("That roll number is already used in this institution.");
    }

    let updated: MembershipRecord | null;
    try {
      updated = await this.store.memberships.update(target.id, {
        ...(input.role ? { role: input.role } : {}),
        ...(input.batchIds ? { batchIds: [...new Set(input.batchIds)] } : {}),
        ...(input.departmentIds ? { departmentIds: [...new Set(input.departmentIds)] } : {}),
        ...(input.rollNumber !== undefined ? { rollNumber: input.rollNumber } : {}),
      });
    } catch (err) {
      if ((err as { code?: number }).code === 11000) throw new ConflictError("That roll number is already used in this institution.");
      throw err;
    }
    const user = await this.store.users.findById(targetUserId);
    if (!updated || !user) throw new NotFoundError("Member", targetUserId);
    if (input.role && input.role !== target.role) {
      await this.audit(actorId, "member.role_changed", institutionId, "member", targetUserId, { from: target.role, to: input.role });
    }
    if (input.batchIds || input.departmentIds) {
      await this.audit(actorId, "member.batches_changed", institutionId, "member", targetUserId, {
        batchIds: updated.batchIds,
        departmentIds: updated.departmentIds ?? [],
      });
    }
    if (input.rollNumber !== undefined && input.rollNumber !== (target.rollNumber ?? null)) {
      await this.audit(actorId, "member.roll_number_changed", institutionId, "member", targetUserId, {
        from: target.rollNumber ?? null,
        to: input.rollNumber,
      });
    }
    return toMemberView(updated, user);
  }

  /** Staff remove people below them (within their scope); anyone can leave. The last owner can't. */
  async removeMember(actorId: string, institutionId: string, targetUserId: string): Promise<void> {
    const leaving = actorId === targetUserId;
    const a = await this.access(actorId, institutionId, leaving ? undefined : "people.manage");
    const target = leaving ? a.membership : await this.store.memberships.find(targetUserId, institutionId);
    if (!target || target.id === "support") throw new NotFoundError("Member", targetUserId);
    if (!leaving) {
      this.assertSenior(a.membership, target);
      if (!a.scope.all && !target.batchIds.some((b) => a.scope.batchIds.includes(b))) {
        throw new ForbiddenError("That member isn't in your batches.");
      }
    }
    if (target.role === "owner" && (await this.store.memberships.countByRole(institutionId, "owner")) <= 1) {
      throw new BadRequestError("member", { reason: "An institution needs at least one owner." });
    }
    await this.store.memberships.delete(target.id);
    await this.audit(actorId, "member.removed", institutionId, "member", target.userId, { role: target.role, left: leaving });
  }

  /* ── Departments ── */

  private departmentView(d: DepartmentRecord, batches: BatchRecord[]): DepartmentView {
    return {
      id: d.id,
      name: d.name,
      code: d.code,
      batchCount: batches.filter((b) => b.departmentId === d.id && !b.archivedAt).length,
      createdAt: d.createdAt.toISOString(),
    };
  }

  async listDepartments(userId: string, institutionId: string): Promise<DepartmentView[]> {
    await this.access(userId, institutionId, "reports.view");
    const [departments, batches] = await Promise.all([
      this.store.departments.listForInstitution(institutionId),
      this.store.batches.listForInstitution(institutionId),
    ]);
    return departments.map((d) => this.departmentView(d, batches));
  }

  private async wideStructure(userId: string, institutionId: string) {
    const a = await this.access(userId, institutionId, "structure.manage");
    if (!a.scope.all) throw new ForbiddenError("Only owners and admins manage departments.");
    return a;
  }

  async createDepartment(userId: string, institutionId: string, input: CreateDepartmentInput): Promise<DepartmentView> {
    await this.wideStructure(userId, institutionId);
    try {
      const d = await this.store.departments.create({ institutionId, name: input.name, code: input.code });
      await this.audit(userId, "department.created", institutionId, "department", d.id, { name: d.name });
      return this.departmentView(d, []);
    } catch (err) {
      if ((err as { code?: number }).code === 11000) throw new ConflictError("A department with this name already exists.");
      throw err;
    }
  }

  async updateDepartment(userId: string, institutionId: string, departmentId: string, input: Partial<CreateDepartmentInput>): Promise<DepartmentView> {
    await this.wideStructure(userId, institutionId);
    const d = await this.store.departments.findById(departmentId);
    if (!d || d.institutionId !== institutionId) throw new NotFoundError("Department", departmentId);
    try {
      const updated = await this.store.departments.update(d.id, {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.code !== undefined ? { code: input.code } : {}),
      });
      await this.audit(userId, "department.updated", institutionId, "department", d.id, { ...input });
      return this.departmentView(updated!, await this.store.batches.listForInstitution(institutionId));
    } catch (err) {
      if ((err as { code?: number }).code === 11000) throw new ConflictError("A department with this name already exists.");
      throw err;
    }
  }

  /** Only empty departments can be deleted: move or archive their batches first. */
  async deleteDepartment(userId: string, institutionId: string, departmentId: string): Promise<void> {
    await this.wideStructure(userId, institutionId);
    const d = await this.store.departments.findById(departmentId);
    if (!d || d.institutionId !== institutionId) throw new NotFoundError("Department", departmentId);
    const batches = await this.store.batches.listForInstitution(institutionId);
    if (batches.some((b) => b.departmentId === d.id)) {
      throw new ConflictError("Move this department's batches to another department first.");
    }
    await this.store.departments.delete(d.id);
    await this.audit(userId, "department.deleted", institutionId, "department", d.id, { name: d.name });
  }

  /* ── Batches ── */

  async checkDepartment(institutionId: string, departmentId: string | null | undefined, scope: AccessScope) {
    if (!departmentId) {
      if (!scope.all) throw new BadRequestError("departmentId", { reason: "Choose one of your departments." });
      return;
    }
    const d = await this.store.departments.findById(departmentId);
    if (!d || d.institutionId !== institutionId) throw new BadRequestError("departmentId", { reason: "Unknown department" });
    if (!scope.all && !scope.departmentIds.includes(departmentId)) throw new ForbiddenError("That department isn't yours.");
  }

  async createBatch(userId: string, institutionId: string, input: CreateBatchInput): Promise<BatchView> {
    const a = await this.access(userId, institutionId, "structure.manage");
    await this.checkDepartment(institutionId, input.departmentId, a.scope);
    if (await this.store.batches.findByName(institutionId, input.name)) {
      throw new ConflictError("A batch with this name already exists.");
    }
    const batch = await this.store.batches.create({
      institutionId,
      name: input.name,
      departmentId: input.departmentId,
      academicYear: input.academicYear,
      archivedAt: null,
    });
    await this.audit(userId, "batch.created", institutionId, "batch", batch.id, { name: batch.name, departmentId: input.departmentId });
    return toBatchView(batch, 0);
  }

  async updateBatch(userId: string, institutionId: string, batchId: string, input: UpdateBatchInput): Promise<BatchView> {
    const a = await this.access(userId, institutionId, "structure.manage");
    const batch = await this.store.batches.findById(batchId);
    if (!batch || batch.institutionId !== institutionId) throw new NotFoundError("Batch", batchId);
    if (!a.scope.all && !a.scope.batchIds.includes(batch.id)) throw new ForbiddenError("That batch isn't yours.");
    if (input.departmentId !== undefined) await this.checkDepartment(institutionId, input.departmentId, a.scope);
    if (input.name && input.name.toLowerCase() !== batch.name.toLowerCase() && (await this.store.batches.findByName(institutionId, input.name))) {
      throw new ConflictError("A batch with this name already exists.");
    }
    const updated = await this.store.batches.update(batch.id, {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.departmentId !== undefined ? { departmentId: input.departmentId } : {}),
      ...(input.academicYear !== undefined ? { academicYear: input.academicYear } : {}),
      ...(input.archived !== undefined ? { archivedAt: input.archived ? new Date() : null } : {}),
    });
    await this.audit(userId, "batch.updated", institutionId, "batch", batch.id, { ...input });
    const counts = await this.store.memberships.countByBatch(institutionId);
    return toBatchView(updated!, counts[batch.id] ?? 0);
  }

  /** Every batch (names aren't secret to staff), with member counts. */
  async listBatches(userId: string, institutionId: string): Promise<BatchView[]> {
    await this.access(userId, institutionId, "reports.view");
    const [batches, counts] = await Promise.all([
      this.store.batches.listForInstitution(institutionId),
      this.store.memberships.countByBatch(institutionId),
    ]);
    return batches.map((b) => toBatchView(b, counts[b.id] ?? 0));
  }

  /* ── Invites ── */

  async createInvite(userId: string, institutionId: string, input: CreateInviteInput): Promise<InviteView> {
    const a = await this.access(userId, institutionId, "people.manage");
    const actorRole = a.membership.role;
    if (actorRole !== "owner" && ROLE_SENIORITY[input.role] >= ROLE_SENIORITY[actorRole]) {
      throw new ForbiddenError("You can only invite people to roles below your own.");
    }
    if (input.batchId) {
      const batch = await this.store.batches.findById(input.batchId);
      if (!batch || batch.institutionId !== institutionId) throw new BadRequestError("batchId", { reason: "Unknown batch" });
      if (batch.archivedAt) throw new BadRequestError("batchId", { reason: "That batch is archived." });
    }
    if (!a.scope.all && (!input.batchId || !a.scope.batchIds.includes(input.batchId))) {
      throw new ForbiddenError("Invite people into one of your batches.");
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
      email: null,
      requiresApproval: input.requiresApproval,
    });
    await this.audit(userId, "invite.created", institutionId, "invite", invite.id, {
      role: invite.role,
      batchId: invite.batchId,
      maxUses: invite.maxUses,
      requiresApproval: input.requiresApproval,
    });
    return toInviteView(invite);
  }

  async listInvites(userId: string, institutionId: string): Promise<InviteView[]> {
    const a = await this.access(userId, institutionId, "people.manage");
    const invites = await this.store.invites.listForInstitution(institutionId);
    return invites
      .filter((i) => a.scope.all || (i.batchId !== null && a.scope.batchIds.includes(i.batchId)))
      .map(toInviteView);
  }

  async revokeInvite(userId: string, institutionId: string, inviteId: string): Promise<void> {
    const a = await this.access(userId, institutionId, "people.manage");
    const invite = await this.store.invites.findById(inviteId);
    if (!invite || invite.institutionId !== institutionId) throw new NotFoundError("Invite", inviteId);
    if (!a.scope.all && (invite.batchId === null || !a.scope.batchIds.includes(invite.batchId))) {
      throw new ForbiddenError("That invite isn't for one of your batches.");
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
      requiresApproval: Boolean(invite.requiresApproval) && invite.role !== "owner",
      asksRollNumber: invite.role === "student" && featuresWithDefaults(institution.features, institution.type).rollNumberLogin,
      ...(reason ? { reason } : {}),
    };
  }

  /** Audit records must never block the action itself. */
  async audit(
    actorId: string,
    action: AuditAction,
    institutionId: string,
    targetType: AuditEvent["targetType"],
    targetId: string,
    meta: Record<string, unknown> = {},
  ) {
    await this.store.audit.record({ actorId, action, institutionId, targetType, targetId, meta }).catch(() => {});
  }
}
