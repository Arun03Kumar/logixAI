import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { createLocalJWKSet } from "jose";
import { createAccessTokenVerifier } from "@logixai/service-kit";
import { buildApp, REFRESH_COOKIE } from "../src/app.js";
import { createTokenIssuer } from "../src/lib/tokens.js";
import { createMemoryStore } from "../src/store/memoryStore.js";

const ISSUER = "test-issuer";

async function setup(opts: { authRateLimit?: number } = {}) {
  const tokens = await createTokenIssuer({
    keyId: "test",
    issuer: ISSUER,
    accessTokenTtlSeconds: 900,
  });
  const app = await buildApp({
    store: createMemoryStore(),
    tokens,
    issuer: ISSUER,
    corsOrigins: ["http://localhost:3008"],
    secureCookies: false,
    refreshTokenTtlDays: 30,
    adminEmails: ["boss@logixai.com"],
    authRateLimit: opts.authRateLimit ?? 1000,
  });
  return { app, tokens };
}

function refreshCookie(res: { cookies: { name: string; value: string }[] }) {
  return res.cookies.find((c) => c.name === REFRESH_COOKIE)?.value;
}

async function signUp(app: FastifyInstance, email: string, name = "Test User") {
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/auth/signup",
    payload: { name, email, password: "correct horse" },
  });
  expect(res.statusCode).toBe(201);
  return {
    token: res.json().data.accessToken as string,
    userId: res.json().data.user.id as string,
    cookie: refreshCookie(res)!,
  };
}

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

afterEach(() => {
  vi.useRealTimers();
});

describe("auth", () => {
  it("signs up, sets an httpOnly refresh cookie and rejects duplicates", async () => {
    const { app } = await setup();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/signup",
      payload: { name: "Asha Rao", email: "  Asha@Example.com ", password: "correct horse" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().data.user).toMatchObject({ email: "asha@example.com", role: "user" });
    const cookie = res.cookies.find((c) => c.name === REFRESH_COOKIE)!;
    expect(cookie).toMatchObject({ httpOnly: true, path: "/api/v1/auth", sameSite: "Lax" });

    const dup = await app.inject({
      method: "POST",
      url: "/api/v1/auth/signup",
      payload: { name: "Asha Rao", email: "asha@example.com", password: "another pass" },
    });
    expect(dup.statusCode).toBe(409);
  });

  it("validates input", async () => {
    const { app } = await setup();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/signup",
      payload: { name: "A", email: "nope", password: "short" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.map((i: { path: string[] }) => i.path[0])).toEqual(
      expect.arrayContaining(["name", "email", "password"]),
    );
  });

  it("gives the same answer for a wrong password and an unknown email", async () => {
    const { app } = await setup();
    await signUp(app, "a@x.com");
    const wrong = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "a@x.com", password: "wrong password" },
    });
    const unknown = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "nobody@x.com", password: "wrong password" },
    });
    expect(wrong.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(wrong.json().message).toBe(unknown.json().message);

    const ok = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "A@X.com", password: "correct horse" },
    });
    expect(ok.statusCode).toBe(200);
  });

  it("issues tokens other services can verify from the JWKS", async () => {
    const { app } = await setup();
    const { token, userId } = await signUp(app, "a@x.com", "Asha");
    const jwks = (await app.inject({ url: "/.well-known/jwks.json" })).json();
    expect(jwks.keys[0]).not.toHaveProperty("d");

    const verifier = createAccessTokenVerifier({
      jwksUrl: "http://unused",
      issuer: ISSUER,
      keys: createLocalJWKSet(jwks),
    });
    await expect(verifier.verify(token)).resolves.toMatchObject({
      sub: userId,
      role: "user",
      name: "Asha",
    });
    await expect(verifier.verify(`${token}x`)).rejects.toMatchObject({ statusCode: 401 });
  });

  it("requires a valid token for /me", async () => {
    const { app } = await setup();
    expect((await app.inject({ url: "/api/v1/auth/me" })).statusCode).toBe(401);
    const { token } = await signUp(app, "a@x.com");
    const me = await app.inject({ url: "/api/v1/auth/me", headers: bearer(token) });
    expect(me.statusCode).toBe(200);
    expect(me.json().data).toMatchObject({ user: { email: "a@x.com" }, memberships: [] });
  });

  it("gives bootstrap emails the admin role", async () => {
    const { app } = await setup();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/signup",
      payload: { name: "Boss", email: "boss@logixai.com", password: "correct horse" },
    });
    expect(res.json().data.user.role).toBe("admin");
  });

  it("rotates refresh tokens and tolerates a concurrent refresh", async () => {
    const { app } = await setup();
    const { cookie } = await signUp(app, "a@x.com");
    const refresh = (value: string) =>
      app.inject({
        method: "POST",
        url: "/api/v1/auth/refresh",
        cookies: { [REFRESH_COOKIE]: value },
      });

    const first = await refresh(cookie);
    expect(first.statusCode).toBe(200);
    const rotated = refreshCookie(first)!;
    expect(rotated).not.toBe(cookie);

    // Second tab refreshing with the old cookie right away: rejected, but not treated as theft.
    expect((await refresh(cookie)).statusCode).toBe(401);
    expect((await refresh(rotated)).statusCode).toBe(200);
  });

  it("ends every session when an old refresh token is replayed later", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { app } = await setup();
    const { cookie } = await signUp(app, "a@x.com");
    const refresh = (value: string) =>
      app.inject({
        method: "POST",
        url: "/api/v1/auth/refresh",
        cookies: { [REFRESH_COOKIE]: value },
      });

    const rotated = refreshCookie(await refresh(cookie))!;
    vi.setSystemTime(Date.now() + 60_000);
    expect((await refresh(cookie)).statusCode).toBe(401); // replay
    expect((await refresh(rotated)).statusCode).toBe(401); // legit session revoked too
  });

  it("signs out by revoking the refresh token", async () => {
    const { app } = await setup();
    const { cookie } = await signUp(app, "a@x.com");
    const out = await app.inject({
      method: "POST",
      url: "/api/v1/auth/logout",
      cookies: { [REFRESH_COOKIE]: cookie },
    });
    expect(out.statusCode).toBe(200);
    const again = await app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      cookies: { [REFRESH_COOKIE]: cookie },
    });
    expect(again.statusCode).toBe(401);
  });

  it("rate-limits sign-in attempts", async () => {
    const { app } = await setup({ authRateLimit: 2 });
    const attempt = () =>
      app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { email: "a@x.com", password: "whatever" },
      });
    await attempt();
    await attempt();
    expect((await attempt()).statusCode).toBe(429);
  });
});

describe("institutions", () => {
  async function withInstitution() {
    const ctx = await setup();
    const owner = await signUp(ctx.app, "owner@x.com", "Owner");
    // Institutions are set up by LogixAI: a platform admin creates it with the owner.
    const boss = await signUp(ctx.app, "boss@logixai.com", "Boss");
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/admin/institutions",
      headers: bearer(boss.token),
      payload: { name: "Delhi Public School", type: "school", ownerEmails: ["owner@x.com"] },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().data.ownersAdded).toEqual(["owner@x.com"]);
    return { ...ctx, owner, boss, institutionId: res.json().data.institution.id as string };
  }

  it("makes the creator the owner and hides it from non-members", async () => {
    const { app, owner, institutionId } = await withInstitution();
    const mine = await app.inject({ url: "/api/v1/auth/me", headers: bearer(owner.token) });
    expect(mine.json().data.memberships[0]).toMatchObject({
      role: "owner",
      institution: { name: "Delhi Public School", slug: "delhi-public-school" },
    });

    const stranger = await signUp(app, "s@x.com");
    const res = await app.inject({
      url: `/api/v1/institutions/${institutionId}`,
      headers: bearer(stranger.token),
    });
    expect(res.statusCode).toBe(404);
  });

  it("joins students through a batch invite and enforces max uses", async () => {
    const { app, owner, institutionId } = await withInstitution();
    const batch = await app.inject({
      method: "POST",
      url: `/api/v1/institutions/${institutionId}/batches`,
      headers: bearer(owner.token),
      payload: { name: "CSE 2026" },
    });
    const batchId = batch.json().data.id;
    const invite = await app.inject({
      method: "POST",
      url: `/api/v1/institutions/${institutionId}/invites`,
      headers: bearer(owner.token),
      payload: { role: "student", batchId, maxUses: 1 },
    });
    expect(invite.statusCode).toBe(201);
    const code = invite.json().data.code as string;
    expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);

    const preview = await app.inject({ url: `/api/v1/invites/${code.toLowerCase()}` });
    expect(preview.json().data).toMatchObject({
      institution: { name: "Delhi Public School" },
      role: "student",
      batchName: "CSE 2026",
      valid: true,
    });

    const student = await signUp(app, "student@x.com", "Student");
    const join = await app.inject({
      method: "POST",
      url: `/api/v1/invites/${code}/accept`,
      headers: bearer(student.token),
    });
    expect(join.json().data).toMatchObject({ role: "student", batchIds: [batchId] });

    const late = await signUp(app, "late@x.com");
    const full = await app.inject({
      method: "POST",
      url: `/api/v1/invites/${code}/accept`,
      headers: bearer(late.token),
    });
    expect(full.statusCode).toBe(400);

    const members = await app.inject({
      url: `/api/v1/institutions/${institutionId}/members`,
      headers: bearer(owner.token),
    });
    expect(members.json().data.items.map((m: { role: string }) => m.role)).toEqual(["owner", "student"]);
    expect(members.json().data.nextCursor).toBeNull();

    const inBatch = await app.inject({
      url: `/api/v1/institutions/${institutionId}/members?batchId=${batchId}`,
      headers: bearer(owner.token),
    });
    expect(inBatch.json().data.items.map((m: { role: string }) => m.role)).toEqual(["student"]);

    const batches = await app.inject({
      url: `/api/v1/institutions/${institutionId}/batches`,
      headers: bearer(owner.token),
    });
    expect(batches.json().data[0]).toMatchObject({ name: "CSE 2026", memberCount: 1 });

    // Students can't see the member list.
    const forbidden = await app.inject({
      url: `/api/v1/institutions/${institutionId}/members`,
      headers: bearer(student.token),
    });
    expect(forbidden.statusCode).toBe(403);
  });

  it("pages members owners-first and records an audit trail", async () => {
    const { app, owner, institutionId } = await withInstitution();
    const invite = (
      await app.inject({
        method: "POST",
        url: `/api/v1/institutions/${institutionId}/invites`,
        headers: bearer(owner.token),
        payload: { role: "student" },
      })
    ).json().data;
    const students: string[] = [];
    for (let i = 0; i < 5; i++) {
      const s = await signUp(app, `p${i}@x.com`, `P${i}`);
      await app.inject({ method: "POST", url: `/api/v1/invites/${invite.code}/accept`, headers: bearer(s.token) });
      students.push(s.userId);
    }

    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const qs: string = `limit=2${cursor ? `&cursor=${cursor}` : ""}`;
      const res = await app.inject({
        url: `/api/v1/institutions/${institutionId}/members?${qs}`,
        headers: bearer(owner.token),
      });
      expect(res.statusCode).toBe(200);
      const page = res.json().data as { items: { role: string; userId: string }[]; nextCursor: string | null };
      expect(page.items.length).toBeLessThanOrEqual(2);
      seen.push(...page.items.map((m) => m.role));
      cursor = page.nextCursor;
    } while (cursor);
    expect(seen).toEqual(["owner", "student", "student", "student", "student", "student"]);

    const lookup = await app.inject({
      url: `/api/v1/institutions/${institutionId}/members?userIds=${students[0]},${students[3]}`,
      headers: bearer(owner.token),
    });
    expect(lookup.json().data.items.map((m: { userId: string }) => m.userId).sort()).toEqual(
      [students[0], students[3]].sort(),
    );

    const bad = await app.inject({
      url: `/api/v1/institutions/${institutionId}/members?cursor=not-a-cursor`,
      headers: bearer(owner.token),
    });
    expect(bad.statusCode).toBe(400);

    const audit = await app.inject({
      url: `/api/v1/institutions/${institutionId}/audit?limit=100`,
      headers: bearer(owner.token),
    });
    const actions = audit.json().data.items.map((e: { action: string }) => e.action);
    expect(actions[0]).toBe("member.joined"); // newest first
    expect(actions).toContain("invite.created");
    expect(actions).toContain("institution.created");
    expect(actions.filter((a: string) => a === "member.joined")).toHaveLength(5);
  });

  it("rejects revoked invites", async () => {
    const { app, owner, institutionId } = await withInstitution();
    const invite = (
      await app.inject({
        method: "POST",
        url: `/api/v1/institutions/${institutionId}/invites`,
        headers: bearer(owner.token),
        payload: {},
      })
    ).json().data;
    await app.inject({
      method: "DELETE",
      url: `/api/v1/institutions/${institutionId}/invites/${invite.id}`,
      headers: bearer(owner.token),
    });
    const preview = await app.inject({ url: `/api/v1/invites/${invite.code}` });
    expect(preview.json().data).toMatchObject({ valid: false, reason: "revoked" });
    const user = await signUp(app, "u@x.com");
    const join = await app.inject({
      method: "POST",
      url: `/api/v1/invites/${invite.code}/accept`,
      headers: bearer(user.token),
    });
    expect(join.statusCode).toBe(400);
  });

  it("protects ownership", async () => {
    const { app, owner, institutionId } = await withInstitution();
    const invite = (
      await app.inject({
        method: "POST",
        url: `/api/v1/institutions/${institutionId}/invites`,
        headers: bearer(owner.token),
        payload: { role: "admin" },
      })
    ).json().data;
    const admin = await signUp(app, "admin@x.com", "Admin");
    await app.inject({
      method: "POST",
      url: `/api/v1/invites/${invite.code}/accept`,
      headers: bearer(admin.token),
    });

    const patch = (token: string, userId: string, role: string) =>
      app.inject({
        method: "PATCH",
        url: `/api/v1/institutions/${institutionId}/members/${userId}`,
        headers: bearer(token),
        payload: { role },
      });

    // Admins can't touch the owner, and can't invite admins.
    expect((await patch(admin.token, owner.userId, "student")).statusCode).toBe(403);
    const adminInvite = await app.inject({
      method: "POST",
      url: `/api/v1/institutions/${institutionId}/invites`,
      headers: bearer(admin.token),
      payload: { role: "admin" },
    });
    expect(adminInvite.statusCode).toBe(403);

    // The only owner can't step down until there's another owner.
    expect((await patch(owner.token, owner.userId, "admin")).statusCode).toBe(400);
    expect((await patch(owner.token, admin.userId, "owner")).statusCode).toBe(200);
    expect((await patch(owner.token, owner.userId, "admin")).statusCode).toBe(200);
  });
});
