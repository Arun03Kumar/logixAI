import { beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { createTokenIssuer } from "../src/lib/tokens.js";
import { createMemoryStore } from "../src/store/memoryStore.js";

let app: FastifyInstance;
type Person = { token: string; id: string };
let boss: Person;

beforeEach(async () => {
  const tokens = await createTokenIssuer({ keyId: "test", issuer: "test", accessTokenTtlSeconds: 900 });
  app = await buildApp({
    store: createMemoryStore(),
    tokens,
    issuer: "test",
    corsOrigins: [],
    secureCookies: false,
    refreshTokenTtlDays: 30,
    adminEmails: ["boss@logixai.com"],
    authRateLimit: 10_000,
  });
  boss = await signUp("boss@logixai.com");
});

async function signUp(email: string): Promise<Person> {
  const res = await app.inject({ method: "POST", url: "/api/v1/auth/signup", payload: { name: email.split("@")[0], email, password: "correct horse" } });
  return { token: res.json().data.accessToken, id: res.json().data.user.id };
}
async function req(who: Person, method: string, url: string, payload?: unknown) {
  const res = await app.inject({ method: method as never, url: `/api/v1${url}`, headers: { authorization: `Bearer ${who.token}` }, payload: payload as never });
  return { status: res.statusCode, data: res.json().data, body: res.json() };
}

/** A college with two departments, made by the platform admin, owned by `owner`. */
async function college(owner: Person, ownerEmail: string) {
  const res = await req(boss, "POST", "/admin/institutions", {
    name: "ABC Engineering College",
    type: "college",
    ownerEmails: [ownerEmail],
    departments: ["Computer Science", "Electronics"],
  });
  expect(res.status).toBe(201);
  const id = res.data.institution.id as string;
  const depts = (await req(owner, "GET", `/institutions/${id}/departments`)).data as { id: string; name: string }[];
  const cs = depts.find((d) => d.name === "Computer Science")!.id;
  const ec = depts.find((d) => d.name === "Electronics")!.id;
  return { id, cs, ec };
}

/** Joins `who` with a fresh invite for `role` into `batchId`. */
async function join(inviter: Person, id: string, who: Person, role: string, batchId?: string) {
  const invite = await req(inviter, "POST", `/institutions/${id}/invites`, { role, ...(batchId ? { batchId } : {}) });
  expect(invite.status, JSON.stringify(invite.body)).toBe(201);
  return req(who, "POST", `/invites/${invite.data.code}/accept`);
}

describe("platform console", () => {
  it("only LogixAI creates institutions", async () => {
    const asha = await signUp("asha@x.com");
    const self = await req(asha, "POST", "/institutions", { name: "My School", type: "school" });
    expect(self.status).toBe(403);
    expect(self.body.message).toMatch(/set up by LogixAI/);
    expect((await req(asha, "POST", "/admin/institutions", { name: "X", type: "school", ownerEmails: ["a@x.com"] })).status).toBe(403);
  });

  it("creates an institution with owners, departments, type defaults and an invite for new owners", async () => {
    const head = await signUp("head@abc.edu");
    const res = await req(boss, "POST", "/admin/institutions", {
      name: "ABC Engineering College",
      type: "college",
      ownerEmails: ["head@abc.edu", "dean@abc.edu"],
      departments: ["Computer Science", "Electronics", "Computer Science"],
      features: { parents: true },
    });
    expect(res.data.ownersAdded).toEqual(["head@abc.edu"]);
    expect(res.data.ownerInvites).toEqual([expect.objectContaining({ email: "dean@abc.edu" })]);
    const inst = res.data.institution;
    expect(inst).toMatchObject({ status: "active", departments: 2, ownerNames: ["head"], roleCounts: { owner: 1, student: 0 } });
    expect(inst.features).toMatchObject({ exams: true, placement: true, accreditation: true, parents: true, rollNumberLogin: false });
    expect(inst.pendingOwnerInvites).toHaveLength(1);

    // The second owner signs up later and accepts the owner code.
    const dean = await signUp("dean@abc.edu");
    const accept = await req(dean, "POST", `/invites/${res.data.ownerInvites[0].code}/accept`);
    expect(accept.data.role).toBe("owner");
    expect((await req(boss, "GET", `/admin/institutions/${inst.id}`)).data).toMatchObject({ roleCounts: { owner: 2 }, pendingOwnerInvites: [] });
    // Owner invites can't be made by institutions themselves.
    expect((await req(head, "POST", `/institutions/${inst.id}/invites`, { role: "owner" })).status).toBe(400);
  });

  it("lists institutions with health figures and edits name, status and features", async () => {
    const head = await signUp("head@abc.edu");
    const { id } = await college(head, "head@abc.edu");
    const list = (await req(boss, "GET", "/admin/institutions?q=abc")).data;
    expect(list[0]).toMatchObject({ id, ownerNames: ["head"], students: 0, staff: 1, activeLast7Days: 1, seats: null });

    await req(boss, "PATCH", `/admin/institutions/${id}`, { name: "ABC College of Engineering" });
    const features = await req(boss, "PUT", `/admin/institutions/${id}/features`, { arena: false });
    expect(features.data.features).toMatchObject({ arena: false, exams: true });
    const mine = (await req(head, "GET", `/institutions/${id}`)).data;
    expect(mine.institution).toMatchObject({ name: "ABC College of Engineering", features: { arena: false } });
    expect((await req(boss, "PUT", `/admin/institutions/${id}/features`, { madeUp: true })).status).toBe(400);
  });

  it("gives LogixAI support access to any institution, recorded in its audit log", async () => {
    const head = await signUp("head@abc.edu");
    const { id } = await college(head, "head@abc.edu");
    const support = (await req(boss, "GET", `/institutions/${id}`)).data;
    expect(support.access).toMatchObject({ role: "owner", support: true, scope: { all: true } });
    await req(boss, "GET", `/institutions/${id}/members`);
    const audit = (await req(head, "GET", `/institutions/${id}/audit?limit=100`)).data.items;
    expect(audit.filter((e: { action: string }) => e.action === "institution.support_access")).toHaveLength(1); // throttled
  });

  it("closes suspended institutions to members but not to support", async () => {
    const head = await signUp("head@abc.edu");
    const { id } = await college(head, "head@abc.edu");
    await req(boss, "PATCH", `/admin/institutions/${id}`, { status: "suspended" });
    const blocked = await req(head, "GET", `/institutions/${id}`);
    expect(blocked.status).toBe(403);
    expect(blocked.body.message).toMatch(/suspended/);
    expect((await req(boss, "GET", `/institutions/${id}`)).status).toBe(200);
  });

  it("enforces the contract's student seats", async () => {
    const head = await signUp("head@abc.edu");
    const { id } = await college(head, "head@abc.edu");
    await req(boss, "PUT", `/admin/institutions/${id}/contract`, {
      model: "flat",
      seats: 1,
      pricePaise: 10_000_000,
      startsAt: new Date(Date.now() - 86_400_000).toISOString(),
      endsAt: new Date(Date.now() + 365 * 86_400_000).toISOString(),
    });
    expect((await join(head, id, await signUp("s1@x.com"), "student")).status).toBe(200);
    const full = await join(head, id, await signUp("s2@x.com"), "student");
    expect(full.status).toBe(409);
    expect(full.body.message).toMatch(/seats/);
    // Staff don't use student seats.
    expect((await join(head, id, await signUp("t1@x.com"), "instructor")).status).toBe(200);
    expect((await req(boss, "PUT", `/admin/institutions/${id}/contract`, { model: "per_seat", seats: null, pricePaise: 1, startsAt: "2026-01-01T00:00:00.000Z", endsAt: "2027-01-01T00:00:00.000Z" })).status).toBe(400);
  });
});

describe("structure and scoped roles", () => {
  let head: Person;
  let inst: { id: string; cs: string; ec: string };
  let csBatch: string;
  let ecBatch: string;
  let hod: Person;

  beforeEach(async () => {
    head = await signUp("head@abc.edu");
    inst = await college(head, "head@abc.edu");
    csBatch = (await req(head, "POST", `/institutions/${inst.id}/batches`, { name: "CSE 2026 A", departmentId: inst.cs, academicYear: "2026-27" })).data.id;
    ecBatch = (await req(head, "POST", `/institutions/${inst.id}/batches`, { name: "ECE 2026", departmentId: inst.ec })).data.id;
    hod = await signUp("hod@abc.edu");
    await join(head, inst.id, hod, "instructor");
    await req(head, "PATCH", `/institutions/${inst.id}/members/${hod.id}`, { role: "dept_head", departmentIds: [inst.cs] });
  });

  it("manages departments (owners and admins), and only empty ones can be deleted", async () => {
    const dup = await req(head, "POST", `/institutions/${inst.id}/departments`, { name: "computer science" });
    expect(dup.status).toBe(409);
    const mech = await req(head, "POST", `/institutions/${inst.id}/departments`, { name: "Mechanical", code: "ME" });
    expect(mech.status).toBe(201);
    expect((await req(hod, "POST", `/institutions/${inst.id}/departments`, { name: "Civil" })).status).toBe(403);
    expect((await req(head, "DELETE", `/institutions/${inst.id}/departments/${inst.cs}`)).status).toBe(409);
    expect((await req(head, "DELETE", `/institutions/${inst.id}/departments/${mech.data.id}`)).status).toBe(200);
    const depts = (await req(head, "GET", `/institutions/${inst.id}/departments`)).data;
    expect(depts.find((d: { name: string }) => d.name === "Computer Science").batchCount).toBe(1);
  });

  it("keeps a department head inside their departments", async () => {
    const access = (await req(hod, "GET", `/institutions/${inst.id}`)).data.access;
    expect(access).toMatchObject({ role: "dept_head", scope: { all: false, batchIds: [csBatch], departmentIds: [inst.cs] } });
    expect(access.capabilities).toEqual(expect.arrayContaining(["people.manage", "tests.manage"]));
    expect(access.capabilities).not.toContain("audit.view");

    expect((await req(hod, "POST", `/institutions/${inst.id}/batches`, { name: "CSE 2026 B", departmentId: inst.cs })).status).toBe(201);
    expect((await req(hod, "POST", `/institutions/${inst.id}/batches`, { name: "ECE 2027", departmentId: inst.ec })).status).toBe(403);
    expect((await req(hod, "POST", `/institutions/${inst.id}/batches`, { name: "No dept" })).status).toBe(400);
    expect((await req(hod, "PATCH", `/institutions/${inst.id}/batches/${ecBatch}`, { name: "x" })).status).toBe(403);

    // Invites only into their batches, only for roles below theirs.
    const student = await signUp("stu@abc.edu");
    expect((await join(hod, inst.id, student, "student", csBatch)).status).toBe(200);
    expect((await req(hod, "POST", `/institutions/${inst.id}/invites`, { role: "student", batchId: ecBatch })).status).toBe(403);
    expect((await req(hod, "POST", `/institutions/${inst.id}/invites`, { role: "student" })).status).toBe(403);
    expect((await req(hod, "POST", `/institutions/${inst.id}/invites`, { role: "admin", batchId: csBatch })).status).toBe(403);

    // Members list is limited to their batches.
    const other = await signUp("ece@abc.edu");
    await join(head, inst.id, other, "student", ecBatch);
    const members = (await req(hod, "GET", `/institutions/${inst.id}/members`)).data.items.map((m: { email: string }) => m.email);
    expect(members).toEqual(["stu@abc.edu"]);
    expect((await req(hod, "GET", `/institutions/${inst.id}/members?batchId=${ecBatch}`)).status).toBe(403);

    // People changes stay in scope and below their own role.
    expect((await req(hod, "PATCH", `/institutions/${inst.id}/members/${other.id}`, { role: "assistant" })).status).toBe(403);
    expect((await req(hod, "PATCH", `/institutions/${inst.id}/members/${student.id}`, { role: "assistant" })).status).toBe(200);
    expect((await req(hod, "PATCH", `/institutions/${inst.id}/members/${student.id}`, { role: "dept_head" })).status).toBe(403);
    expect((await req(hod, "PATCH", `/institutions/${inst.id}/members/${student.id}`, { batchIds: [ecBatch] })).status).toBe(403);
    expect((await req(hod, "GET", `/institutions/${inst.id}/audit`)).status).toBe(403);
  });

  it("gives instructors and assistants no people or structure powers", async () => {
    const teacher = await signUp("teacher@abc.edu");
    await join(head, inst.id, teacher, "instructor", csBatch);
    expect((await req(teacher, "POST", `/institutions/${inst.id}/invites`, { role: "student", batchId: csBatch })).status).toBe(403);
    expect((await req(teacher, "POST", `/institutions/${inst.id}/batches`, { name: "Mine", departmentId: inst.cs })).status).toBe(403);
    expect((await req(teacher, "GET", `/institutions/${inst.id}/batches`)).status).toBe(200);

    const ta = await signUp("ta@abc.edu");
    await join(head, inst.id, ta, "assistant", csBatch);
    const access = (await req(ta, "GET", `/institutions/${inst.id}`)).data.access;
    expect(access.capabilities).toEqual(["tests.grade", "reports.view"]);
  });

  it("archives batches, which then take no new invites", async () => {
    const res = await req(head, "PATCH", `/institutions/${inst.id}/batches/${csBatch}`, { archived: true, academicYear: "2025-26" });
    expect(res.data).toMatchObject({ archived: true, academicYear: "2025-26", departmentId: inst.cs });
    expect((await req(head, "POST", `/institutions/${inst.id}/invites`, { role: "student", batchId: csBatch })).status).toBe(400);
  });

  it("only owners create admins; admins can't touch other admins", async () => {
    const admin1 = await signUp("a1@abc.edu");
    await join(head, inst.id, admin1, "admin");
    const admin2 = await signUp("a2@abc.edu");
    await join(head, inst.id, admin2, "admin");
    expect((await req(admin1, "POST", `/institutions/${inst.id}/invites`, { role: "admin" })).status).toBe(403);
    expect((await req(admin1, "PATCH", `/institutions/${inst.id}/members/${admin2.id}`, { role: "student" })).status).toBe(403);
    expect((await req(admin1, "DELETE", `/institutions/${inst.id}/members/${admin2.id}`)).status).toBe(403);
    expect((await req(admin1, "PATCH", `/institutions/${inst.id}/members/${hod.id}`, { departmentIds: [inst.cs, inst.ec] })).status).toBe(200);
  });
});
