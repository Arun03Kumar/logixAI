import type { InstitutionRole, MemberView } from "@logixai/contracts";
import { InternalServerError } from "@logixai/service-kit";

export interface Membership {
  role: InstitutionRole;
  batchIds: string[];
}

/**
 * Asks identity-service about the caller's institution membership by
 * forwarding their own access token, so identity-service's permission rules
 * apply and no service-to-service secret is needed.
 */
export interface IdentityClient {
  /** null when the caller isn't a member. */
  getMembership(authorization: string, institutionId: string): Promise<Membership | null>;
  listMembers(authorization: string, institutionId: string): Promise<MemberView[]>;
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

      const res = await get<{ role: InstitutionRole; batchIds: string[] }>(
        `/institutions/${encodeURIComponent(institutionId)}`,
        authorization,
      );
      if (res.status !== 200 && res.status !== 404 && res.status !== 403) {
        throw new InternalServerError({ reason: `identity-service answered ${res.status}` });
      }
      const value = res.data ? { role: res.data.role, batchIds: res.data.batchIds } : null;
      cache.set(key, { at: Date.now(), value });
      if (cache.size > 5000) cache.clear();
      return value;
    },
    async listMembers(authorization, institutionId) {
      const res = await get<MemberView[]>(
        `/institutions/${encodeURIComponent(institutionId)}/members`,
        authorization,
      );
      return res.data ?? [];
    },
  };
}
