import { beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { createTokenIssuer } from "../src/lib/tokens.js";
import { createMemoryStore } from "../src/store/memoryStore.js";

let app: FastifyInstance;
type Person = { token: string; id: string };
let boss: Person;
let head: Person;
let inst: { id: string; slug: string; cse: string; ece: string; cs: string };

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
  head = await signUp("head@abc.edu.in");
  const res = await req(boss, "POST", "/admin/institutions", {
    name: "ABC School",
    type: "school", // roll-number login on by default
    ownerEmails: ["head@abc.edu.in"],
    departments: ["Science"],
    contract: { model: "per_seat", seats: 3, pricePaise: 100, startsAt: new Date(Date.now() - 1000).toISOString(), endsAt: new Date(Date.now() + 864e5 * 365).toISOString() },
  });
  const id = res.data.institution.id as string;
  const cs = (await req(head, "GET", `/institutions/${id}/departments`)).data[0].id as string;
  const cse = (await req(head, "POST", `/institutions/${id}/batches`, { name: "Class 9A", departmentId: cs, academicYear: "2026-27" })).data.id as string;
  const ece = (await req(head, "POST", `/institutions/${id}/batches`, { name: "Class 9B", departmentId: cs })).data.id as string;
  inst = { id, slug: res.data.institution.slug, cse, ece, cs };
});

async function signUp(email: string): Promise<Person> {
  const res = await app.inject({ method: "POST", url: "/api/v1/auth/signup", payload: { name: email.split("@")[0], email, password: "correct horse" } });
  return { token: res.json().data.accessToken, id: res.json().data.user.id };
}
async function req(who: Person, method: string, url: string, payload?: unknown) {
  const res = await app.inject({ method: method as never, url: `/api/v1${url}`, headers: { authorization: `Bearer ${who.token}` }, payload: payload as never });
  return { status: res.statusCode, data: res.json().data, body: res.json() };
}
const rollLogin = (rollNumber: string, password: string, institution = inst.slug) =>
  app.inject({ method: "POST", url: "/api/v1/auth/login/roll-number", payload: { institution, rollNumber, password } });
const row = (name: string, rollNumber = "", email = "", batch = "") => ({ name, rollNumber, email, batch });

describe("CSV import", () => {
  it("checks a file on a dry run without changing anything", async () => {
    await signUp("asha@x.com");
    const res = await req(head, "POST", `/institutions/${inst.id}/import`, {
      dryRun: true,
      batchId: inst.cse,
      rows: [row("Ravi Kumar", "9a-01"), row("Asha", "", "asha@x.com"), row("X"), row("Meera", "9A-01"), row("Kiran", "9A-03", "", "Class 12")],
    });
    expect(res.status).toBe(200);
    expect(res.data.counts).toEqual({ created: 1, added: 1, updated: 0, unchanged: 0, error: 3 });
    expect(res.data.rows.map((r: { status: string }) => r.status)).toEqual(["created", "added", "error", "error", "error"]);
    expect(res.data.rows[0]).toMatchObject({ rollNumber: "9A-01", batchName: "Class 9A" });
    expect(res.data.rows[0].tempPassword).toBeUndefined();
    expect(res.data.rows[3].message).toMatch(/repeats row 1/);
    expect(res.data.rows[4].message).toMatch(/no batch called Class 12/);
    const members = await req(head, "GET", `/institutions/${inst.id}/members`);
    expect(members.data.items).toHaveLength(1);
  });

  it("creates roll-number accounts that sign in, must change password, and fills seats", async () => {
    const res = await req(head, "POST", `/institutions/${inst.id}/import`, {
      batchId: inst.cse,
      createBatches: true,
      rows: [row("Ravi Kumar", "9A-01"), row("Meera Iyer", "9A-02", "", "Class 10A"), row("Kiran", "9A-03", "kiran@x.com"), row("Late", "9A-04")],
    });
    expect(res.data.counts).toMatchObject({ created: 3, error: 1 });
    expect(res.data.rows[3].message).toMatch(/No student seats left/);
    expect(res.data.batchesCreated).toEqual(["Class 10A"]);
    const ravi = res.data.rows[0];
    expect(ravi.tempPassword).toMatch(/^[a-z2-9]{10}$/);

    expect((await rollLogin("9a-01", "wrong-pass")).statusCode).toBe(401);
    const login = await rollLogin("9a-01", ravi.tempPassword);
    expect(login.statusCode).toBe(200);
    const session = login.json().data;
    expect(session.user).toMatchObject({ name: "Ravi Kumar", email: "", mustChangePassword: true });
    expect(session.user.plan.tier).toBe("pro");

    const student = { token: session.accessToken, id: session.user.id };
    const changed = await req(student, "POST", "/auth/password", { currentPassword: ravi.tempPassword, newPassword: "my own secret" });
    expect(changed.status).toBe(200);
    expect(changed.data.user.mustChangePassword).toBe(false);
    expect((await rollLogin("9A-01", ravi.tempPassword)).statusCode).toBe(401);
    expect((await rollLogin("9A-01", "my own secret")).statusCode).toBe(200);

    // Imported email accounts sign in with email too.
    const kiran = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email: "kiran@x.com", password: res.data.rows[2].tempPassword } });
    expect(kiran.statusCode).toBe(200);

    const members = (await req(head, "GET", `/institutions/${inst.id}/members?role=student`)).data.items;
    expect(members.find((m: { name: string }) => m.name === "Ravi Kumar")).toMatchObject({ rollNumber: "9A-01", managed: true, email: "" });
  });

  it("re-importing updates batches and roll numbers instead of duplicating", async () => {
    await req(head, "POST", `/institutions/${inst.id}/import`, { batchId: inst.cse, rows: [row("Ravi", "9A-01")] });
    const again = await req(head, "POST", `/institutions/${inst.id}/import`, { batchId: inst.ece, rows: [row("Ravi", "9A-01"), row("Ravi", "9A-01")] });
    expect(again.data.rows.map((r: { status: string }) => r.status)).toEqual(["updated", "error"]);
    const ravi = (await req(head, "GET", `/institutions/${inst.id}/members?role=student`)).data.items[0];
    expect(ravi.batchIds.sort()).toEqual([inst.cse, inst.ece].sort());
  });

  it("needs email when roll-number login is off, and keeps scoped staff to their batches", async () => {
    await req(boss, "PUT", `/admin/institutions/${inst.id}/features`, { rollNumberLogin: false });
    const res = await req(head, "POST", `/institutions/${inst.id}/import`, { batchId: inst.cse, rows: [row("Ravi", "9A-01")] });
    expect(res.data.rows[0].message).toMatch(/Add an email/);
    expect((await rollLogin("9A-01", "whatever")).statusCode).toBe(401);

    const teacher = await signUp("teacher@x.com");
    const inv = await req(head, "POST", `/institutions/${inst.id}/invites`, { role: "dept_head" });
    await req(teacher, "POST", `/invites/${inv.data.code}/accept`);
    await req(head, "PATCH", `/institutions/${inst.id}/members/${teacher.id}`, { batchIds: [inst.cse] });
    const scoped = await req(teacher, "POST", `/institutions/${inst.id}/import`, { rows: [row("Anu", "", "a@x.com", "Class 9B"), row("Bee", "", "b@x.com")] });
    expect(scoped.data.rows[0].message).toMatch(/isn't one of your batches/);
    expect(scoped.data.rows[1].message).toMatch(/Choose one of your batches/);
    expect((await req(teacher, "POST", `/institutions/${inst.id}/import`, { batchId: inst.ece, rows: [row("Ann", "", "a@x.com")] })).status).toBe(403);
  });
});

describe("passwords", () => {
  it("resets only accounts the institution created", async () => {
    const imported = await req(head, "POST", `/institutions/${inst.id}/import`, { batchId: inst.cse, rows: [row("Ravi", "9A-01")] });
    const own = await signUp("own@x.com");
    const inv = await req(head, "POST", `/institutions/${inst.id}/invites`, { role: "student", batchId: inst.cse });
    await req(own, "POST", `/invites/${inv.data.code}/accept`);
    const members = (await req(head, "GET", `/institutions/${inst.id}/members?role=student`)).data.items;
    const raviId = members.find((m: { name: string }) => m.name === "Ravi").userId;

    const first = (await rollLogin("9A-01", imported.data.rows[0].tempPassword)).json().data;
    const reset = await req(head, "POST", `/institutions/${inst.id}/members/${raviId}/password`);
    expect(reset.status).toBe(200);
    expect(reset.data.tempPassword).not.toBe(imported.data.rows[0].tempPassword);
    // Old sessions end.
    const refreshed = await app.inject({ method: "POST", url: "/api/v1/auth/refresh", cookies: { lx_rt: "x" } });
    expect(refreshed.statusCode).toBe(401);
    expect(first.user.mustChangePassword).toBe(true);
    expect((await rollLogin("9A-01", reset.data.tempPassword)).statusCode).toBe(200);

    const blocked = await req(head, "POST", `/institutions/${inst.id}/members/${own.id}/password`);
    expect(blocked.status).toBe(403);
    expect(blocked.body.message).toMatch(/only they can change/);
  });

  it("rejects a wrong current password", async () => {
    const asha = await signUp("asha@x.com");
    expect((await req(asha, "POST", "/auth/password", { currentPassword: "nope-nope", newPassword: "another one" })).status).toBe(401);
  });
});

describe("approvals", () => {
  it("queues people who join with an approval invite until staff decide", async () => {
    const inv = await req(head, "POST", `/institutions/${inst.id}/invites`, { role: "student", batchId: inst.cse, requiresApproval: true });
    expect(inv.data.requiresApproval).toBe(true);
    const preview = await app.inject({ method: "GET", url: `/api/v1/invites/${inv.data.code}` });
    expect(preview.json().data).toMatchObject({ requiresApproval: true, asksRollNumber: true });

    const asha = await signUp("asha@x.com");
    const ravi = await signUp("ravi@x.com");
    const joined = await req(asha, "POST", `/invites/${inv.data.code}/accept`, { rollNumber: "9a-07" });
    expect(joined.status).toBe(202);
    expect(joined.data).toMatchObject({ pending: true, institution: { name: "ABC School" } });
    expect((await req(asha, "POST", `/invites/${inv.data.code}/accept`)).status).toBe(409);
    expect((await req(asha, "GET", `/institutions/${inst.id}`)).status).toBe(404);
    await req(ravi, "POST", `/invites/${inv.data.code}/accept`);

    const queue = (await req(head, "GET", `/institutions/${inst.id}/join-requests`)).data;
    expect(queue.map((r: { name: string }) => r.name).sort()).toEqual(["asha", "ravi"]);
    const ashaReq = queue.find((r: { name: string }) => r.name === "asha");
    expect(ashaReq).toMatchObject({ rollNumber: "9A-07", batchId: inst.cse, source: "invite" });

    const approved = await req(head, "POST", `/institutions/${inst.id}/join-requests/${ashaReq.id}/decision`, { approve: true });
    expect(approved.data.status).toBe("approved");
    expect((await req(head, "POST", `/institutions/${inst.id}/join-requests/${ashaReq.id}/decision`, { approve: false })).status).toBe(409);
    const ashaView = await req(asha, "GET", `/institutions/${inst.id}`);
    expect(ashaView.data).toMatchObject({ role: "student", batchIds: [inst.cse] });

    const raviReq = queue.find((r: { name: string }) => r.name === "ravi");
    await req(head, "POST", `/institutions/${inst.id}/join-requests/${raviReq.id}/decision`, { approve: false });
    expect((await req(ravi, "GET", `/institutions/${inst.id}`)).status).toBe(404);
    expect((await req(head, "GET", `/institutions/${inst.id}/join-requests`)).data).toEqual([]);
    expect((await req(head, "GET", `/institutions/${inst.id}/join-requests?status=rejected`)).data).toHaveLength(1);
  });

  it("lets people with the institution's email domain ask to join", async () => {
    expect((await req(boss, "PATCH", `/admin/institutions/${inst.id}`, { emailDomains: ["gmail.com"] })).status).toBe(400);
    const set = await req(boss, "PATCH", `/admin/institutions/${inst.id}`, { emailDomains: ["@ABC.edu.in"] });
    expect(set.data.emailDomains).toEqual(["abc.edu.in"]);

    const priya = await signUp("priya@abc.edu.in");
    const outsider = await signUp("outsider@other.com");
    // The feature is off for schools by default.
    expect((await req(priya, "GET", "/institutions/suggested")).data).toEqual([]);
    await req(boss, "PUT", `/admin/institutions/${inst.id}/features`, { domainJoin: true });
    expect((await req(priya, "GET", "/institutions/suggested")).data).toEqual([
      { id: inst.id, name: "ABC School", type: "school", domain: "abc.edu.in", pending: false },
    ]);
    expect((await req(outsider, "POST", `/institutions/${inst.id}/join-requests`, {})).status).toBe(404);

    expect((await req(priya, "POST", `/institutions/${inst.id}/join-requests`, {})).status).toBe(202);
    expect((await req(priya, "GET", "/institutions/suggested")).data[0].pending).toBe(true);
    const [request] = (await req(head, "GET", `/institutions/${inst.id}/join-requests`)).data;
    expect(request).toMatchObject({ source: "domain", batchId: null, email: "priya@abc.edu.in" });
    await req(head, "POST", `/institutions/${inst.id}/join-requests/${request.id}/decision`, { approve: true, batchId: inst.ece });
    expect((await req(priya, "GET", `/institutions/${inst.id}`)).data.batchIds).toEqual([inst.ece]);
    expect((await req(priya, "GET", "/institutions/suggested")).data).toEqual([]);
  });
});

describe("year rollover", () => {
  it("moves a batch's students into next year's batch, archives the old one and frees seats", async () => {
    await req(head, "POST", `/institutions/${inst.id}/import`, { batchId: inst.cse, rows: [row("Ravi", "1"), row("Meera", "2"), row("Kiran", "3")] });
    // Seats are full.
    const full = await req(head, "POST", `/institutions/${inst.id}/import`, { batchId: inst.ece, rows: [row("Late", "4")] });
    expect(full.data.rows[0].message).toMatch(/No student seats/);

    const promoted = await req(head, "POST", `/institutions/${inst.id}/batches/${inst.cse}/promote`, {
      newBatch: { name: "Class 10A", academicYear: "2027-28" },
    });
    expect(promoted.status).toBe(200);
    expect(promoted.data).toMatchObject({ moved: 3, sourceArchived: true, to: { name: "Class 10A", academicYear: "2027-28", memberCount: 3, departmentId: inst.cs } });
    const batches = (await req(head, "GET", `/institutions/${inst.id}/batches`)).data;
    expect(batches.find((b: { id: string }) => b.id === inst.cse)).toMatchObject({ archived: true, memberCount: 0 });

    // Graduating: archive the batch, and its students stop using seats.
    await req(head, "PATCH", `/institutions/${inst.id}/batches/${promoted.data.to.id}`, { archived: true });
    const now = await req(head, "POST", `/institutions/${inst.id}/import`, { batchId: inst.ece, rows: [row("Late", "4")] });
    expect(now.data.rows[0].status).toBe("created");

    expect((await req(head, "POST", `/institutions/${inst.id}/batches/${inst.ece}/promote`, { toBatchId: inst.ece })).status).toBe(400);
    expect((await req(head, "POST", `/institutions/${inst.id}/batches/${inst.ece}/promote`, {})).status).toBe(400);
  });
});

describe("roll numbers on members", () => {
  it("are unique within an institution and editable by staff", async () => {
    const asha = await signUp("asha@x.com");
    const ravi = await signUp("ravi@x.com");
    const inv = await req(head, "POST", `/institutions/${inst.id}/invites`, { role: "student", batchId: inst.cse });
    expect((await req(asha, "POST", `/invites/${inv.data.code}/accept`, { rollNumber: "R1" })).status).toBe(200);
    expect((await req(ravi, "POST", `/invites/${inv.data.code}/accept`, { rollNumber: "r1" })).status).toBe(409);
    await req(ravi, "POST", `/invites/${inv.data.code}/accept`);
    expect((await req(head, "PATCH", `/institutions/${inst.id}/members/${ravi.id}`, { rollNumber: "R1" })).status).toBe(409);
    const ok = await req(head, "PATCH", `/institutions/${inst.id}/members/${ravi.id}`, { rollNumber: "r2" });
    expect(ok.data).toMatchObject({ rollNumber: "R2", managed: false });
    // Members with their own account can sign in by roll number too.
    expect((await rollLogin("R2", "correct horse")).statusCode).toBe(200);
  });
});
