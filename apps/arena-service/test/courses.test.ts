import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { UnauthorizedError, type AccessTokenVerifier } from "@logixai/service-kit";
import { buildApp } from "../src/app.js";
import { loadCatalog, type Catalog } from "../src/content/catalog.js";
import { createMemoryStore } from "../src/store/memoryStore.js";

/* Areas (ML / frontend / system design) and courses (ordered modules). */

const CONTENT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "content");
const catalog: Catalog = loadCatalog(CONTENT);

const verifier: AccessTokenVerifier = {
  async verify(token) {
    return { sub: token, role: "user", name: token, email: `${token}@x.com`, plan: "free", planUntil: null };
  },
  async verifyHeader(header) {
    const token = String(header ?? "").replace(/^Bearer /, "");
    if (!token) throw new UnauthorizedError();
    return this.verify(token);
  },
};

let app: FastifyInstance;
beforeEach(async () => {
  ({ app } = await buildApp({
    catalog,
    store: createMemoryStore(),
    judge: { submit: async () => {} },
    identity: { getMembership: async () => null, myMemberships: async () => [], listBatches: async () => [], listBatchMembers: async () => [] },
    verifier,
    corsOrigins: [],
    now: () => new Date("2026-11-21T06:00:00Z"),
  }));
});

async function req(user: string | null, method: string, url: string, payload?: unknown) {
  const res = await app.inject({
    method: method as never,
    url: `/api/v1/arena${url}`,
    headers: user ? { authorization: `Bearer ${user}` } : {},
    payload: payload as never,
  });
  return { status: res.statusCode, data: res.json().data };
}

describe("areas", () => {
  it("every track, list and mock belongs to one area, and filters by it", async () => {
    const all = (await req(null, "GET", "/tracks")).data;
    expect(all.every((t: { area: string }) => ["ml", "frontend", "system-design"].includes(t.area))).toBe(true);
    const ml = (await req(null, "GET", "/tracks?area=ml")).data;
    const fe = (await req(null, "GET", "/tracks?area=frontend")).data;
    const sd = (await req(null, "GET", "/tracks?area=system-design")).data;
    expect(fe.map((t: { id: string }) => t.id)).toEqual(["frontend-interview"]);
    expect(sd.map((t: { id: string }) => t.id)).toEqual(["system-design"]);
    expect(ml.length + fe.length + sd.length).toBe(all.length);
    expect(ml.some((t: { id: string }) => t.id === "frontend-interview")).toBe(false);
    expect((await req(null, "GET", "/tracks?area=nope")).status).toBe(400);

    const problems = (await req(null, "GET", "/problems?area=frontend")).data;
    expect(problems.items.every((p: { area: string }) => p.area === "frontend")).toBe(true);
    expect(problems.total).toBeGreaterThan(20);

    const lists = (await req(null, "GET", "/lists?area=system-design")).data;
    expect(lists.map((l: { id: string }) => l.id)).toEqual(["system-design-runnable"]);

    const item = (await req(null, "GET", "/items/react-bounded-counter")).data;
    expect(item.area).toBe("frontend");
    expect(catalog.practice.mocks.find((m) => m.id === "frontend-coding")!.area).toBe("frontend");
  });
});

describe("area-scoped views", () => {
  it("dashboard, skill map and review queue show one area only", async () => {
    await req("asha", "POST", "/items/react-keys/answer", { selectedOptionIds: ["b"] });
    await req("asha", "POST", "/items/sql-null-not-equal-mcq/answer", { selectedOptionIds: ["b"] });

    const ml = (await req("asha", "GET", "/me/dashboard?area=ml")).data;
    expect(ml.tracks.every((t: { area: string }) => t.area === "ml")).toBe(true);
    expect(ml.totalItems).toBe(catalog.items.filter((i) => i.area === "ml").length);
    expect(ml.recommendations.every((r: { itemId?: string }) => !r.itemId || catalog.item(r.itemId)!.area === "ml")).toBe(true);
    const fe = (await req("asha", "GET", "/me/dashboard?area=frontend")).data;
    expect(fe.tracks.map((t: { id: string }) => t.id)).toEqual(["frontend-interview"]);
    expect(fe.solvedCount).toBe(1);

    const map = (await req(null, "GET", "/skill-map?area=system-design")).data;
    expect(map.topics.every((t: { trackId: string }) => t.trackId === "system-design")).toBe(true);
    const ids = new Set(map.topics.map((t: { id: string }) => t.id));
    expect(map.edges.every((e: { from: string; to: string }) => ids.has(e.from) && ids.has(e.to))).toBe(true);

    // Unscoped still covers everything.
    expect((await req("asha", "GET", "/me/dashboard")).data.totalItems).toBe(catalog.items.length);
  });
});

describe("courses", () => {
  it("lists the ML course with modules, sections and the next step", async () => {
    const courses = (await req(null, "GET", "/courses?area=ml")).data;
    expect(courses.map((c: { id: string }) => c.id)).toEqual(["ml-from-zero"]);
    expect((await req(null, "GET", "/courses?area=frontend")).data).toEqual([]);

    const course = (await req("asha", "GET", "/courses/ml-from-zero")).data;
    expect(course.modules[0]).toMatchObject({ number: 1, status: "available", trackId: "course-m1-maths" });
    expect(course.modules[0].sections[0]).toMatchObject({ id: "maths-algebra-functions" });
    expect(course.modules[1]).toMatchObject({ number: 2, trackId: "course-m2-python" });
    const planned = course.modules.filter((m: { status: string }) => m.status === "planned");
    expect(planned.length).toBeGreaterThan(0);
    expect(planned.every((m: { sections: unknown[]; practice: unknown[] }) => m.sections.length === 0 && m.practice.length > 0)).toBe(true);
    expect(course.availableModules).toBe(course.modules.length - planned.length);
    // A fresh learner starts at the first item of Module 1.
    const first = catalog.track("course-m1-maths")!.topics[0]!.items[0]!;
    expect(course.next).toMatchObject({ itemId: first.id, moduleNumber: 1 });

    // Solving it moves "next" on.
    await req("asha", "POST", `/items/${first.id}/answer`, { value: (first as { answer: number }).answer });
    const after = (await req("asha", "GET", "/courses/ml-from-zero")).data;
    expect(after.next.itemId).not.toBe(first.id);
    expect(after.solvedCount).toBe(1);

    // Module tracks know their course.
    const tracks = (await req(null, "GET", "/tracks?area=ml")).data;
    expect(tracks.find((t: { id: string }) => t.id === "course-m2-python").courseId).toBe("ml-from-zero");
    expect(tracks.find((t: { id: string }) => t.id === "sql-interview").courseId).toBeUndefined();
    expect((await req(null, "GET", "/courses/nope")).status).toBe(404);
  });
});
