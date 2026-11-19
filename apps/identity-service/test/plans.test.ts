import { describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createLocalJWKSet } from "jose";
import { hasPro } from "@logixai/contracts";
import { createAccessTokenVerifier } from "@logixai/service-kit";
import { buildApp, REFRESH_COOKIE } from "../src/app.js";
import { createTokenIssuer } from "../src/lib/tokens.js";
import { createMemoryStore } from "../src/store/memoryStore.js";

const ISSUER = "test-issuer";
const INTERNAL = "internal-secret-0123456789";

async function setup() {
  const tokens = await createTokenIssuer({ keyId: "test", issuer: ISSUER, accessTokenTtlSeconds: 900 });
  const app = await buildApp({
    store: createMemoryStore(),
    tokens,
    issuer: ISSUER,
    corsOrigins: [],
    secureCookies: false,
    refreshTokenTtlDays: 30,
    adminEmails: ["boss@logixai.com"],
    authRateLimit: 1000,
    internalToken: INTERNAL,
  });
  const verifier = createAccessTokenVerifier({ jwksUrl: "http://unused", issuer: ISSUER, keys: createLocalJWKSet(tokens.jwks()) });
  return { app, verifier };
}

async function signUp(app: FastifyInstance, email: string) {
  const res = await app.inject({ method: "POST", url: "/api/v1/auth/signup", payload: { name: email.split("@")[0], email, password: "correct horse" } });
  const cookie = res.cookies.find((c) => c.name === REFRESH_COOKIE)!.value;
  return { token: res.json().data.accessToken as string, user: res.json().data.user, cookie };
}

async function refresh(app: FastifyInstance, cookie: string) {
  const res = await app.inject({ method: "POST", url: "/api/v1/auth/refresh", cookies: { [REFRESH_COOKIE]: cookie } });
  return {
    session: res.json().data,
    cookie: res.cookies.find((c) => c.name === REFRESH_COOKIE)!.value,
  };
}

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
const grant = (app: FastifyInstance, body: unknown, token: string | null = INTERNAL) =>
  app.inject({
    method: "POST",
    url: "/internal/entitlements/grant",
    headers: token ? { "x-internal-token": token } : {},
    payload: body as never,
  });

describe("plans", () => {
  it("starts on free, in the session and in the token", async () => {
    const { app, verifier } = await setup();
    const asha = await signUp(app, "asha@x.com");
    expect(asha.user.plan).toEqual({ tier: "free", until: null, source: null });
    const claims = await verifier.verify(asha.token);
    expect(claims).toMatchObject({ plan: "free", planUntil: null });
    expect(hasPro(claims)).toBe(false);
  });

  it("grants personal Pro once per reference, through the internal API only", async () => {
    const { app, verifier } = await setup();
    const asha = await signUp(app, "asha@x.com");
    const body = { userId: asha.user.id, days: 30, reference: "order-1", source: "purchase" };

    expect((await grant(app, body, null)).statusCode).toBe(401);
    expect((await grant(app, body, "wrong-secret-0123456789")).statusCode).toBe(401);

    const first = await grant(app, body);
    expect(first.json().data.applied).toBe(true);
    const until = new Date(first.json().data.proUntil).getTime();
    expect(until - Date.now()).toBeGreaterThan(29.9 * 86_400_000);

    // A retried webhook or verify call doesn't add days twice.
    const again = await grant(app, body);
    expect(again.json().data).toMatchObject({ applied: false, proUntil: first.json().data.proUntil });

    // A second purchase stacks on the end of the first.
    const second = await grant(app, { ...body, reference: "order-2", days: 365 });
    expect(new Date(second.json().data.proUntil).getTime() - until).toBeGreaterThan(364.9 * 86_400_000);

    const { session } = await refresh(app, asha.cookie);
    expect(session.user.plan).toMatchObject({ tier: "pro", source: "personal" });
    const claims = await verifier.verify(session.accessToken);
    expect(hasPro(claims)).toBe(true);
    expect(claims.planUntil).toBe(Math.floor(new Date(second.json().data.proUntil).getTime() / 1000));
  });

  it("finds users by email for admin grants", async () => {
    const { app } = await setup();
    const asha = await signUp(app, "asha@x.com");
    const res = await app.inject({ url: "/internal/users/by-email?email=ASHA@x.com", headers: { "x-internal-token": INTERNAL } });
    expect(res.json().data).toEqual({ id: asha.user.id, name: "asha", email: "asha@x.com" });
    expect((await app.inject({ url: "/internal/users/by-email?email=nobody@x.com", headers: { "x-internal-token": INTERNAL } })).statusCode).toBe(404);
  });
});

describe("institution contracts", () => {
  it("give every member Pro while the contract runs; platform admins only", async () => {
    const { app } = await setup();
    const owner = await signUp(app, "owner@x.com");
    const boss = await signUp(app, "boss@logixai.com");
    const inst = await app.inject({
      method: "POST",
      url: "/api/v1/admin/institutions",
      headers: bearer(boss.token),
      payload: { name: "Delhi Public School", type: "school", ownerEmails: ["owner@x.com"] },
    });
    const id = inst.json().data.institution.id;
    const contract = {
      model: "per_seat",
      seats: 100,
      pricePaise: 50_000,
      startsAt: new Date(Date.now() - 86_400_000).toISOString(),
      endsAt: new Date(Date.now() + 90 * 86_400_000).toISOString(),
    };

    const denied = await app.inject({ method: "PUT", url: `/api/v1/admin/institutions/${id}/contract`, headers: bearer(owner.token), payload: contract });
    expect(denied.statusCode).toBe(403);

    const set = await app.inject({ method: "PUT", url: `/api/v1/admin/institutions/${id}/contract`, headers: bearer(boss.token), payload: contract });
    expect(set.json().data.contract).toMatchObject({ model: "per_seat", seats: 100, endsAt: contract.endsAt });

    const { session } = await refresh(app, owner.cookie);
    expect(session.user.plan).toEqual({ tier: "pro", until: contract.endsAt, source: "institution" });

    // Suspending stops the licence; removing the contract does too.
    await app.inject({ method: "PATCH", url: `/api/v1/admin/institutions/${id}`, headers: bearer(boss.token), payload: { status: "suspended" } });
    expect((await app.inject({ url: "/api/v1/auth/me", headers: bearer(session.accessToken) })).json().data.user.plan.tier).toBe("free");
    await app.inject({ method: "PATCH", url: `/api/v1/admin/institutions/${id}`, headers: bearer(boss.token), payload: { status: "active" } });
    expect((await app.inject({ url: "/api/v1/auth/me", headers: bearer(session.accessToken) })).json().data.user.plan.tier).toBe("pro");
    await app.inject({ method: "PUT", url: `/api/v1/admin/institutions/${id}/contract`, headers: bearer(boss.token), payload: { contract: null } });
    expect((await app.inject({ url: "/api/v1/auth/me", headers: bearer(session.accessToken) })).json().data.user.plan.tier).toBe("free");

    const audit = await app.inject({ url: `/api/v1/institutions/${id}/audit`, headers: bearer(owner.token) });
    const actions = audit.json().data.items.map((e: { action: string }) => e.action);
    expect(actions.filter((a: string) => a === "institution.contract_changed")).toHaveLength(2);
    expect(actions.filter((a: string) => a === "institution.status_changed")).toHaveLength(2);
  });
});
