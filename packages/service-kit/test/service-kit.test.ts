import { afterEach, describe, expect, it } from "vitest";
import {
  BadRequestError,
  NotFoundError,
  env,
  errorResponse,
  loadConfig,
  successResponse,
  z,
} from "../src";

describe("loadConfig", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it("treats an empty variable as unset, so the default applies", () => {
    process.env.LX_TEST_LIMIT = "";
    process.env.LX_TEST_NAME = "   ";
    const cfg = loadConfig(
      z.object({ LX_TEST_LIMIT: z.coerce.number().int().positive().default(30), LX_TEST_NAME: z.string().default("x") }),
      { exitOnError: false },
    );
    expect(cfg).toMatchObject({ LX_TEST_LIMIT: 30, LX_TEST_NAME: "x" });
  });

  it("applies defaults and coerces numbers", () => {
    delete process.env.PORT;
    process.env.REDIS_PORT = "6380";
    const config = loadConfig(
      z.object({ PORT: env.port(4000), REDIS_PORT: env.redisPort() }),
    );
    expect(config).toEqual({ PORT: 4000, REDIS_PORT: 6380 });
  });

  it("throws a readable error for invalid config when exitOnError is false", () => {
    delete process.env.REQUIRED_THING;
    expect(() =>
      loadConfig(z.object({ REQUIRED_THING: z.string() }), {
        serviceName: "test",
        exitOnError: false,
      }),
    ).toThrow(/REQUIRED_THING/);
  });

  it("splits comma-separated lists", () => {
    process.env.ORIGINS = "http://a, http://b";
    const config = loadConfig(z.object({ ORIGINS: env.list([]) }));
    expect(config.ORIGINS).toEqual(["http://a", "http://b"]);
  });
});

describe("responses", () => {
  it("wraps data in the success envelope", () => {
    expect(successResponse({ id: 1 }, "done")).toEqual({
      success: true,
      message: "done",
      error: {},
      data: { id: 1 },
    });
  });

  it("maps known errors to their status code", () => {
    expect(errorResponse(new NotFoundError("Problem", "x")).statusCode).toBe(404);
    const bad = errorResponse(new BadRequestError("body", [{ path: "a" }]));
    expect(bad.statusCode).toBe(400);
    expect(bad.body.error).toEqual([{ path: "a" }]);
  });

  it("hides unknown errors behind a 500", () => {
    const res = errorResponse(new Error("db down"));
    expect(res.statusCode).toBe(500);
    expect(res.body.message).toBe("Something went wrong");
  });
});
