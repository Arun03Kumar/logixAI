import { describe, expect, it, vi } from "vitest";
import { UnauthorizedError } from "@logixai/service-kit";
import { createRequireAdmin } from "../src/middlewares/auth";

function verifierReturning(claims) {
  return {
    verifyHeader: vi.fn(async (header) => {
      if (!header) throw new UnauthorizedError();
      return claims;
    }),
  };
}

async function run(middleware, headers = {}) {
  const req = { headers };
  const next = vi.fn();
  await middleware(req, {}, next);
  return { req, error: next.mock.calls[0]?.[0] };
}

describe("requireAdmin", () => {
  it("rejects requests without a token", async () => {
    const { error } = await run(createRequireAdmin(verifierReturning({ role: "admin" })));
    expect(error.statusCode).toBe(401);
  });

  it("rejects signed-in users who aren't admins", async () => {
    const { error } = await run(
      createRequireAdmin(verifierReturning({ sub: "u1", role: "user" })),
      { authorization: "Bearer x" },
    );
    expect(error.statusCode).toBe(403);
  });

  it("lets admins through and exposes the claims", async () => {
    const claims = { sub: "u1", role: "admin" };
    const { req, error } = await run(createRequireAdmin(verifierReturning(claims)), {
      authorization: "Bearer x",
    });
    expect(error).toBeUndefined();
    expect(req.auth).toEqual(claims);
  });
});
