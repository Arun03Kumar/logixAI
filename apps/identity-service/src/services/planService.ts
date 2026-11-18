/**
 * Who has Pro. identity-service is the source of truth: billing-service grants
 * personal Pro through the internal API, platform admins set institution
 * licences, and the result goes into the session and the access token.
 */
import {
  FREE_PLAN,
  type AdminInstitutionView,
  type EntitlementGrantInput,
  type InstitutionLicenceInput,
  type PlanState,
} from "@logixai/contracts";
import { NotFoundError } from "@logixai/service-kit";
import type { InstitutionRecord, Store, UserRecord } from "../store/types.js";

/** Personal Pro, or an institution licence through any membership — whichever ends later. */
export async function planFor(store: Store, user: UserRecord, now = new Date()): Promise<PlanState> {
  let best: PlanState = FREE_PLAN;
  let bestUntil = 0;
  if (user.proUntil && user.proUntil > now) {
    best = { tier: "pro", until: user.proUntil.toISOString(), source: "personal" };
    bestUntil = user.proUntil.getTime();
  }
  const memberships = await store.memberships.listForUser(user.id);
  if (memberships.length) {
    const institutions = await store.institutions.findByIds(memberships.map((m) => m.institutionId));
    for (const inst of institutions) {
      if (inst.licenceUntil && inst.licenceUntil > now && inst.licenceUntil.getTime() > bestUntil) {
        best = { tier: "pro", until: inst.licenceUntil.toISOString(), source: "institution" };
        bestUntil = inst.licenceUntil.getTime();
      }
    }
  }
  return best;
}

export class PlanService {
  constructor(private readonly store: Store) {}

  /** Internal (billing-service): add days of personal Pro, once per reference. */
  async grant(input: EntitlementGrantInput, now = new Date()): Promise<{ proUntil: string | null; applied: boolean }> {
    const user = await this.store.users.findById(input.userId);
    if (!user) throw new NotFoundError("User", input.userId);
    const applied = await this.store.entitlements.recordGrant({ ...input, at: now });
    const proUntil = applied
      ? await this.store.users.extendPro(user.id, input.days, now)
      : (user.proUntil ?? null);
    return { proUntil: proUntil ? proUntil.toISOString() : null, applied };
  }

  /** Internal: look a user up by email (admin grants are made by email). */
  async userByEmail(email: string): Promise<{ id: string; name: string; email: string }> {
    const user = await this.store.users.findByEmail(email.trim().toLowerCase());
    if (!user) throw new NotFoundError("User", email);
    return { id: user.id, name: user.name, email: user.email };
  }

  async listInstitutions(query: string | undefined): Promise<AdminInstitutionView[]> {
    const rows = await this.store.institutions.search(query?.trim() || undefined, 50);
    const counts = await this.store.memberships.countForInstitutions(rows.map((r) => r.id));
    return rows.map((r) => this.view(r, counts[r.id] ?? 0));
  }

  async setLicence(
    actorId: string,
    institutionId: string,
    input: InstitutionLicenceInput,
  ): Promise<AdminInstitutionView> {
    const updated = await this.store.institutions.setLicence(
      institutionId,
      input.until ? new Date(input.until) : null,
      input.until ? input.seats : null,
    );
    if (!updated) throw new NotFoundError("Institution", institutionId);
    await this.store.audit
      .record({
        actorId,
        action: "institution.licence_changed",
        institutionId,
        targetType: "institution",
        targetId: institutionId,
        meta: { until: input.until, seats: input.until ? input.seats : null },
      })
      .catch(() => {});
    const counts = await this.store.memberships.countForInstitutions([institutionId]);
    return this.view(updated, counts[institutionId] ?? 0);
  }

  private view(r: InstitutionRecord, memberCount: number): AdminInstitutionView {
    return {
      id: r.id,
      name: r.name,
      slug: r.slug,
      type: r.type,
      memberCount,
      licenceUntil: r.licenceUntil ? r.licenceUntil.toISOString() : null,
      licenceSeats: r.licenceSeats ?? null,
      createdAt: r.createdAt.toISOString(),
    };
  }
}
