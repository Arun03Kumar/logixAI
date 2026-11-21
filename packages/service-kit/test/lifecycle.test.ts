import { describe, expect, it } from "vitest";
import { readiness, redisReady, registerHealthRoutes } from "../src";

describe("readiness", () => {
  it("is ready only when every check passes, and treats a throwing check as failed", async () => {
    expect(await readiness({ a: () => true, b: async () => true })).toMatchObject({ ok: true, status: "ready" });
    const failed = await readiness({
      a: () => true,
      b: () => {
        throw new Error("down");
      },
    });
    expect(failed).toEqual({ ok: false, status: "not-ready", checks: { a: true, b: false } });
  });

  it("reads the ioredis status", async () => {
    expect(await redisReady({ status: "ready" })()).toBe(true);
    expect(await redisReady({ status: "reconnecting" })()).toBe(false);
  });
});

describe("registerHealthRoutes", () => {
  // Records routes like Fastify/Express; replies like Fastify (code/send) or Express (status/json).
  const fakeApp = () => {
    const routes = new Map<string, (req: unknown, res: unknown) => unknown>();
    return { routes, get: (path: string, handler: (req: unknown, res: unknown) => unknown) => routes.set(path, handler) };
  };
  const call = async (handler: (req: unknown, res: unknown) => unknown, style: "fastify" | "express") => {
    const out = { code: 0, body: undefined as unknown };
    const res =
      style === "fastify"
        ? { code: (c: number) => ({ send: (b: unknown) => Object.assign(out, { code: c, body: b }) }) }
        : { status: (c: number) => ({ json: (b: unknown) => Object.assign(out, { code: c, body: b }) }) };
    await handler({}, res);
    return out;
  };

  it("answers /healthz always and /readyz from the checks", async () => {
    let up = false;
    const app = fakeApp();
    registerHealthRoutes(app, { db: () => up });

    for (const style of ["fastify", "express"] as const) {
      up = false;
      expect((await call(app.routes.get("/healthz")!, style)).code).toBe(200);
      const down = await call(app.routes.get("/readyz")!, style);
      expect(down.code).toBe(503);
      expect(down.body).toMatchObject({ ok: false, checks: { db: false } });
      up = true;
      expect((await call(app.routes.get("/readyz")!, style)).code).toBe(200);
    }
  });
});
