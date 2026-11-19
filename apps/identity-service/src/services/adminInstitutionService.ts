/**
 * LogixAI's own console: create institutions, see their health, and change
 * anything about them — status, features, contract, owners. Platform admins
 * only (checked by the routes). Everything is recorded in the institution's
 * audit log, where its own admins can see it.
 */
import {
  INSTITUTION_ROLES,
  featuresWithDefaults,
  type AdminCreateInstitutionInput,
  type AdminCreateInstitutionResult,
  type AdminInstitutionDetail,
  type AdminInstitutionSummary,
  type AdminUpdateInstitutionInput,
  type ContractInput,
  type InstitutionRole,
  type OwnerInviteView,
  type UpdateFeaturesInput,
} from "@logixai/contracts";
import { NotFoundError } from "@logixai/service-kit";
import { newInviteCode } from "../lib/tokens.js";
import type { ContractRecord, InstitutionRecord, Store } from "../store/types.js";
import type { InstitutionService } from "./institutionService.js";

const OWNER_INVITE_DAYS = 30;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

const contractView = (c: ContractRecord | null | undefined) =>
  c
    ? {
        model: c.model,
        seats: c.seats,
        pricePaise: c.pricePaise,
        startsAt: c.startsAt.toISOString(),
        endsAt: c.endsAt.toISOString(),
        notes: c.notes,
        updatedAt: c.updatedAt.toISOString(),
      }
    : null;

export class AdminInstitutionService {
  constructor(
    private readonly store: Store,
    private readonly institutions: InstitutionService,
  ) {}

  private async mustInstitution(id: string): Promise<InstitutionRecord> {
    const inst = await this.store.institutions.findById(id);
    if (!inst) throw new NotFoundError("Institution", id);
    return inst;
  }

  private async summaries(rows: InstitutionRecord[], now = new Date()): Promise<AdminInstitutionSummary[]> {
    const ids = rows.map((r) => r.id);
    const [roles, active] = await Promise.all([
      this.store.memberships.roleCounts(ids),
      this.store.memberships.activeSince(ids, new Date(now.getTime() - WEEK_MS)),
    ]);
    const owners = await Promise.all(
      rows.map((r) => this.store.memberships.pageForInstitution(r.id, { limit: 5, role: "owner" })),
    );
    const ownerUsers = await this.store.users.findByIds(owners.flatMap((p) => p.items.map((m) => m.userId)));
    const nameOf = new Map(ownerUsers.map((u) => [u.id, u.name]));
    return rows.map((r, i) => {
      const counts = roles[r.id] ?? {};
      const students = counts.student ?? 0;
      const total = Object.values(counts).reduce((s, n) => s + (n ?? 0), 0);
      return {
        id: r.id,
        name: r.name,
        slug: r.slug,
        type: r.type,
        status: r.status ?? "active",
        ownerNames: owners[i]!.items.map((m) => nameOf.get(m.userId) ?? "Unknown"),
        students,
        staff: total - students,
        seats: r.contract?.seats ?? null,
        contractEndsAt: r.contract ? r.contract.endsAt.toISOString() : null,
        activeLast7Days: active[r.id] ?? 0,
        createdAt: r.createdAt.toISOString(),
      };
    });
  }

  async list(query: string | undefined): Promise<AdminInstitutionSummary[]> {
    return this.summaries(await this.store.institutions.search(query?.trim() || undefined, 100));
  }

  async detail(id: string): Promise<AdminInstitutionDetail> {
    const inst = await this.mustInstitution(id);
    const [[summary], departments, batches, roles, invites] = await Promise.all([
      this.summaries([inst]),
      this.store.departments.listForInstitution(id),
      this.store.batches.listForInstitution(id),
      this.store.memberships.roleCounts([id]),
      this.store.invites.listForInstitution(id),
    ]);
    const roleCounts = Object.fromEntries(INSTITUTION_ROLES.map((r) => [r, roles[id]?.[r] ?? 0])) as Record<InstitutionRole, number>;
    const now = Date.now();
    return {
      ...summary!,
      features: featuresWithDefaults(inst.features, inst.type),
      emailDomains: inst.emailDomains ?? [],
      contract: contractView(inst.contract),
      departments: departments.length,
      batches: batches.filter((b) => !b.archivedAt).length,
      roleCounts,
      pendingOwnerInvites: invites
        .filter((i) => i.role === "owner" && !i.revokedAt && i.uses === 0 && i.expiresAt.getTime() > now)
        .map((i) => ({ email: i.email ?? "", code: i.code, expiresAt: i.expiresAt.toISOString() })),
    };
  }

  async create(actorId: string, input: AdminCreateInstitutionInput): Promise<AdminCreateInstitutionResult> {
    const inst = await this.institutions.createRecord(actorId, input.name, input.type);
    if (input.features) await this.store.institutions.update(inst.id, { features: input.features });
    for (const name of [...new Set(input.departments)]) {
      await this.store.departments.create({ institutionId: inst.id, name, code: "" }).catch((err: { code?: number }) => {
        if (err.code !== 11000) throw err; // a repeated name is fine
      });
    }
    if (input.contract) await this.applyContract(actorId, inst.id, input.contract);
    const ownersAdded: string[] = [];
    const ownerInvites: OwnerInviteView[] = [];
    for (const email of [...new Set(input.ownerEmails)]) {
      const added = await this.addOwnerRecord(actorId, inst.id, email);
      if (added.kind === "added") ownersAdded.push(email);
      else ownerInvites.push(added.invite);
    }
    return { institution: await this.detail(inst.id), ownersAdded, ownerInvites };
  }

  async update(actorId: string, id: string, input: AdminUpdateInstitutionInput): Promise<AdminInstitutionDetail> {
    const inst = await this.mustInstitution(id);
    await this.store.institutions.update(id, {
      ...input,
      ...(input.emailDomains ? { emailDomains: [...new Set(input.emailDomains)] } : {}),
    });
    if (input.status && input.status !== (inst.status ?? "active")) {
      await this.institutions.audit(actorId, "institution.status_changed", id, "institution", id, {
        from: inst.status ?? "active",
        to: input.status,
      });
    }
    const { status: _status, ...rest } = input;
    if (Object.keys(rest).length) await this.institutions.audit(actorId, "institution.updated", id, "institution", id, rest);
    return this.detail(id);
  }

  async setFeatures(actorId: string, id: string, input: UpdateFeaturesInput): Promise<AdminInstitutionDetail> {
    const inst = await this.mustInstitution(id);
    const features = { ...(inst.features ?? {}), ...input };
    await this.store.institutions.update(id, { features });
    await this.institutions.audit(actorId, "institution.features_changed", id, "institution", id, input);
    return this.detail(id);
  }

  /** The contract sets the licence: every member has Pro until it ends; students can't exceed its seats. */
  private async applyContract(actorId: string, id: string, input: ContractInput | null) {
    const contract: ContractRecord | null = input
      ? {
          model: input.model,
          seats: input.seats,
          pricePaise: input.pricePaise,
          startsAt: new Date(input.startsAt),
          endsAt: new Date(input.endsAt),
          notes: input.notes,
          updatedAt: new Date(),
        }
      : null;
    await this.store.institutions.update(id, {
      contract,
      licenceUntil: contract?.endsAt ?? null,
      licenceSeats: contract?.seats ?? null,
    });
    await this.institutions.audit(actorId, "institution.contract_changed", id, "institution", id, {
      model: input?.model ?? null,
      seats: input?.seats ?? null,
      endsAt: input?.endsAt ?? null,
    });
  }

  async setContract(actorId: string, id: string, input: ContractInput | null): Promise<AdminInstitutionDetail> {
    await this.mustInstitution(id);
    await this.applyContract(actorId, id, input);
    return this.detail(id);
  }

  async addOwner(actorId: string, id: string, email: string): Promise<{ added: boolean; invite: OwnerInviteView | null }> {
    await this.mustInstitution(id);
    const res = await this.addOwnerRecord(actorId, id, email);
    return res.kind === "added" ? { added: true, invite: null } : { added: false, invite: res.invite };
  }

  /** An existing account becomes owner now; anyone else gets a one-use owner invite code. */
  private async addOwnerRecord(
    actorId: string,
    institutionId: string,
    email: string,
  ): Promise<{ kind: "added" } | { kind: "invited"; invite: OwnerInviteView }> {
    const user = await this.store.users.findByEmail(email.toLowerCase());
    if (user) {
      const existing = await this.store.memberships.find(user.id, institutionId);
      if (existing) {
        if (existing.role !== "owner") await this.store.memberships.update(existing.id, { role: "owner" });
      } else {
        await this.store.memberships.create({ userId: user.id, institutionId, role: "owner", batchIds: [], departmentIds: [] });
      }
      await this.institutions.audit(actorId, "institution.owner_added", institutionId, "member", user.id, { email });
      return { kind: "added" };
    }
    const invite = await this.store.invites.create({
      institutionId,
      code: newInviteCode(),
      role: "owner",
      batchId: null,
      maxUses: 1,
      uses: 0,
      expiresAt: new Date(Date.now() + OWNER_INVITE_DAYS * 24 * 60 * 60 * 1000),
      revokedAt: null,
      createdBy: actorId,
      email,
    });
    await this.institutions.audit(actorId, "institution.owner_added", institutionId, "invite", invite.id, { email, invited: true });
    return { kind: "invited", invite: { email, code: invite.code, expiresAt: invite.expiresAt.toISOString() } };
  }
}
