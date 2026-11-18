import type { EntitlementGrantInput } from "@logixai/contracts";
import { InternalServerError, NotFoundError, internalHeaders } from "@logixai/service-kit";

/** identity-service's internal API: grants Pro and finds users by email. */
export interface IdentityGateway {
  grantPro(input: EntitlementGrantInput): Promise<{ proUntil: string | null; applied: boolean }>;
  userByEmail(email: string): Promise<{ id: string; name: string; email: string }>;
}

export function createHttpIdentityGateway(baseUrl: string, internalToken: string | undefined): IdentityGateway {
  async function call<T>(path: string, init: RequestInit = {}): Promise<{ status: number; data?: T }> {
    let res: Response;
    try {
      res = await fetch(`${baseUrl}${path}`, {
        ...init,
        headers: { "Content-Type": "application/json", ...internalHeaders(internalToken), ...(init.headers ?? {}) },
      });
    } catch (err) {
      throw new InternalServerError({ reason: "identity-service unreachable", cause: String(err) });
    }
    const body = (await res.json().catch(() => null)) as { data?: T } | null;
    return { status: res.status, ...(body?.data !== undefined ? { data: body.data } : {}) };
  }
  return {
    async grantPro(input) {
      const res = await call<{ proUntil: string | null; applied: boolean }>("/internal/entitlements/grant", {
        method: "POST",
        body: JSON.stringify(input),
      });
      if (res.status !== 200 || !res.data) throw new InternalServerError({ reason: `identity-service grant answered ${res.status}` });
      return res.data;
    },
    async userByEmail(email) {
      const res = await call<{ id: string; name: string; email: string }>(`/internal/users/by-email?${new URLSearchParams({ email })}`);
      if (res.status === 404) throw new NotFoundError("User", email);
      if (res.status !== 200 || !res.data) throw new InternalServerError({ reason: `identity-service lookup answered ${res.status}` });
      return res.data;
    },
  };
}
