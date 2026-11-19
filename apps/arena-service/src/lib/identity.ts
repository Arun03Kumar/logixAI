import {
  DEFAULT_FEATURES,
  capabilitiesFor,
  hasInstitutionWideScope,
  type AccessScope,
  type Capability,
  type FeatureFlags,
  type InstitutionRole,
  type MemberView,
  type MembershipSummary,
} from "@logixai/contracts";
import { InternalServerError } from "@logixai/service-kit";

export interface Membership {
  role: InstitutionRole;
  batchIds: string[];
  capabilities: Capability[];
  scope: AccessScope;
  features: FeatureFlags;
}

/** Capabilities and scope derived from the role (tests, and identity responses without `access`). */
export function membershipFromRole(role: InstitutionRole, batchIds: string[], features?: Partial<FeatureFlags>): Membership {
  return {
    role,
    batchIds,
    capabilities: capabilitiesFor(role),
    scope: { all: hasInstitutionWideScope(role), batchIds, departmentIds: [] },
    features: { ...DEFAULT_FEATURES.other, ...(features ?? {}) },
  };
}

/**
 * Asks identity-service about institutions by forwarding the caller's own
 * access token, so identity-service's permission rules apply and no
 * service-to-service secret is needed.
 */
export interface IdentityClient {
  /** null when the caller isn't a member. */
  getMembership(authorization: string, institutionId: string): Promise<Membership | null>;
  /** The caller's institutions and batches. */
  myMemberships(authorization: string): Promise<MembershipSummary[]>;
  /** Batch ids and names of an institution (staff only). */
  listBatches(authorization: string, institutionId: string): Promise<{ id: string; name: string }[]>;
  /** Everyone in a batch (staff only), fetched 100 at a time. */
  listBatchMembers(authorization: string, institutionId: string, batchId: string): Promise<MemberView[]>;
}

const CACHE_MS = 30_000;
/** Safety cap on one batch report. */
const MAX_BATCH_MEMBERS = 2000;

export function createHttpIdentityClient(baseUrl: string): IdentityClient {
  const cache = new Map<string, { at: number; value: Membership | null }>();

  async function get<T>(path: string, authorization: string): Promise<{ status: number; data?: T }> {
    let res: Response;
    try {
      res = await fetch(`${baseUrl}${path}`, { headers: { authorization } });
    } catch (err) {
      throw new InternalServerError({ reason: "identity-service unreachable", cause: String(err) });
    }
    if (!res.ok) return { status: res.status };
    const body = (await res.json()) as { data: T };
    return { status: res.status, data: body.data };
  }
  const must = <T>(res: { status: number; data?: T }): T => {
    if (res.status !== 200 || res.data === undefined) {
      throw new InternalServerError({ reason: `identity-service answered ${res.status}` });
    }
    return res.data;
  };
  const inst = (id: string) => `/institutions/${encodeURIComponent(id)}`;

  return {
    async getMembership(authorization, institutionId) {
      const key = `${authorization}|${institutionId}`;
      const hit = cache.get(key);
      if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
      const res = await get<MembershipSummary>(inst(institutionId), authorization);
      if (res.status !== 200 && res.status !== 404 && res.status !== 403) {
        throw new InternalServerError({ reason: `identity-service answered ${res.status}` });
      }
      const d = res.data;
      const value: Membership | null = d
        ? {
            ...membershipFromRole(d.role, d.batchIds, d.institution.features),
            ...(d.access ? { capabilities: d.access.capabilities, scope: d.access.scope } : {}),
          }
        : null;
      cache.set(key, { at: Date.now(), value });
      if (cache.size > 5000) cache.clear();
      return value;
    },
    async myMemberships(authorization) {
      return must(await get<{ memberships: MembershipSummary[] }>("/auth/me", authorization)).memberships;
    },
    async listBatches(authorization, institutionId) {
      return must(await get<{ id: string; name: string }[]>(`${inst(institutionId)}/batches`, authorization));
    },
    async listBatchMembers(authorization, institutionId, batchId) {
      const members: MemberView[] = [];
      let cursor: string | null = null;
      do {
        const qs = new URLSearchParams({ limit: "100", batchId, ...(cursor ? { cursor } : {}) });
        const page: { items: MemberView[]; nextCursor: string | null } = must(
          await get<{ items: MemberView[]; nextCursor: string | null }>(`${inst(institutionId)}/members?${qs}`, authorization),
        );
        members.push(...page.items);
        cursor = page.nextCursor;
      } while (cursor && members.length < MAX_BATCH_MEMBERS);
      return members;
    },
  };
}
