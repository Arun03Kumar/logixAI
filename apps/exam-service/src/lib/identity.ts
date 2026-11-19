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
  /** What identity-service says the caller may do here. */
  capabilities: Capability[];
  /** The batches they act on (all, for owners and admins). */
  scope: AccessScope;
  /** Which product areas the institution has switched on. */
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
 * Asks identity-service about the caller's institution membership by
 * forwarding their own access token, so identity-service's permission rules
 * apply and no service-to-service secret is needed.
 */
export interface IdentityClient {
  /** null when the caller isn't a member. */
  getMembership(authorization: string, institutionId: string): Promise<Membership | null>;
  /** The named members (missing ones are left out). Fetched 100 at a time. */
  lookupMembers(authorization: string, institutionId: string, userIds: string[]): Promise<MemberView[]>;
}

const CACHE_MS = 30_000;

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

  return {
    async getMembership(authorization, institutionId) {
      const key = `${authorization}|${institutionId}`;
      const hit = cache.get(key);
      if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;

      const res = await get<MembershipSummary>(
        `/institutions/${encodeURIComponent(institutionId)}`,
        authorization,
      );
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
    async lookupMembers(authorization, institutionId, userIds) {
      const unique = [...new Set(userIds)];
      const found: MemberView[] = [];
      for (let i = 0; i < unique.length; i += 100) {
        const ids = unique.slice(i, i + 100).map(encodeURIComponent).join(",");
        const res = await get<{ items: MemberView[] }>(
          `/institutions/${encodeURIComponent(institutionId)}/members?limit=100&userIds=${ids}`,
          authorization,
        );
        if (res.status !== 200) {
          throw new InternalServerError({ reason: `identity-service answered ${res.status}` });
        }
        found.push(...(res.data?.items ?? []));
      }
      return found;
    },
  };
}
