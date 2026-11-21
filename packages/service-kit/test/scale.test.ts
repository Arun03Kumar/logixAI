import { afterEach, describe, expect, it } from "vitest";
import { cacheControl, poolSettings, rateLimitStore, weakEtag } from "../src";

describe("poolSettings", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it("uses options, then MONGO_* env, then defaults", () => {
    delete process.env.MONGO_MAX_POOL_SIZE;
    delete process.env.MONGO_MIN_POOL_SIZE;
    expect(poolSettings()).toEqual({ maxPoolSize: 20, minPoolSize: 0, maxIdleTimeMS: 60_000 });

    process.env.MONGO_MAX_POOL_SIZE = "8";
    process.env.MONGO_MIN_POOL_SIZE = "2";
    expect(poolSettings()).toMatchObject({ maxPoolSize: 8, minPoolSize: 2 });
    expect(poolSettings({ maxPoolSize: 50 })).toMatchObject({ maxPoolSize: 50, minPoolSize: 2 });
  });

  it("ignores empty or invalid values and keeps min <= max", () => {
    process.env.MONGO_MAX_POOL_SIZE = "";
    process.env.MONGO_MIN_POOL_SIZE = "lots";
    expect(poolSettings()).toMatchObject({ maxPoolSize: 20, minPoolSize: 0 });
    expect(poolSettings({ maxPoolSize: 3, minPoolSize: 10 })).toMatchObject({ maxPoolSize: 3, minPoolSize: 3 });
  });
});

describe("rateLimitStore", () => {
  it("is in memory without Redis, and shared, namespaced and fail-open with it", () => {
    expect(rateLimitStore(undefined, "arena")).toEqual({});
    const redis = {} as never;
    expect(rateLimitStore(redis, "arena")).toEqual({ redis, nameSpace: "logixai:rl:arena:", skipOnError: true });
  });
});

describe("cache helpers", () => {
  it("builds Cache-Control and stable weak ETags", () => {
    expect(cacheControl({ maxAge: 60, sMaxAge: 300 })).toBe("public, max-age=60, s-maxage=300, stale-while-revalidate=600");
    expect(cacheControl({ maxAge: 10 })).toBe("public, max-age=10, s-maxage=10, stale-while-revalidate=20");
    expect(weakEtag("abc")).toBe(weakEtag("abc"));
    expect(weakEtag("abc")).not.toBe(weakEtag("abd"));
    expect(weakEtag("abc")).toMatch(/^W\/"[A-Za-z0-9_-]+"$/);
  });
});
