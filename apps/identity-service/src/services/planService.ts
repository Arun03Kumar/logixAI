/**
 * Who has Pro. identity-service is the source of truth: billing-service grants
 * personal Pro through the internal API, institution contracts set licences
 * (adminInstitutionService), and the result goes into the session and token.
 */
import { FREE_PLAN, type EntitlementGrantInput, type PlanState } from "@logixai/contracts";
import { NotFoundError } from "@logixai/service-kit";
import type { Store, UserRecord } from "../store/types.js";

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
      // Suspended or archived institutions don't grant Pro.
      if ((inst.status ?? "active") !== "active") continue;
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
    return { id: user.id, name: user.name, email: user.email ?? "" };
  }
}
