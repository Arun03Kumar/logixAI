import { describe, expect, it } from "vitest";
import { LANGUAGES } from "@logixai/contracts";
import { createWarmPool } from "../src/sandbox/warmPool.js";
import type { Sandbox, SandboxFactory } from "../src/sandbox/types.js";

/** A fake factory that counts containers and records destroys. */
function fakeFactory() {
  let created = 0;
  const destroyed: number[] = [];
  const factory: SandboxFactory = {
    async create() {
      const id = ++created;
      const sandbox: Sandbox & { id: number } = {
        id,
        exec: async () => ({ exitCode: 0, stdout: "", stderr: "", timedOut: false, outputLimited: false, durationMs: 0 }),
        destroy: async () => {
          destroyed.push(id);
        },
      };
      return sandbox;
    },
  };
  return { factory, created: () => created, destroyed };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("warm sandbox pool", () => {
  it("hands out pre-started sandboxes, each only once, and refills in the background", async () => {
    const fake = fakeFactory();
    const pool = createWarmPool(fake.factory, { size: 2, languages: [LANGUAGES.PYTHON_ML] });
    await tick();
    expect(fake.created()).toBe(2);
    expect(pool.stats()).toEqual({ PYTHON_ML: 2 });

    const a = (await pool.create(LANGUAGES.PYTHON_ML)) as Sandbox & { id: number };
    const b = (await pool.create(LANGUAGES.PYTHON_ML)) as Sandbox & { id: number };
    expect([a.id, b.id]).toEqual([1, 2]); // the warm ones, not new ones
    await tick();
    expect(fake.created()).toBe(4); // two replacements started
    expect(pool.stats()).toEqual({ PYTHON_ML: 2 });
    await pool.close();
    expect(fake.destroyed.sort()).toEqual([3, 4]); // idle ones are cleaned up on shutdown
  });

  it("creates on demand when empty or for languages it doesn't keep warm", async () => {
    const fake = fakeFactory();
    const pool = createWarmPool(fake.factory, { size: 1, languages: [LANGUAGES.NODE_WEB] });
    await tick();
    const cpp = (await pool.create(LANGUAGES.CPP)) as Sandbox & { id: number };
    expect(cpp.id).toBe(2);
    expect(pool.stats()).toEqual({ NODE_WEB: 1 });
    await pool.close();
  });

  it("never hands out a sandbox that has been idle too long", async () => {
    const fake = fakeFactory();
    const pool = createWarmPool(fake.factory, { size: 1, languages: [LANGUAGES.PYTHON_ML], maxIdleMs: 0 });
    await tick();
    await new Promise((r) => setTimeout(r, 5));
    const s = (await pool.create(LANGUAGES.PYTHON_ML)) as Sandbox & { id: number };
    expect(s.id).not.toBe(1);
    expect(fake.destroyed).toContain(1);
    await pool.close();
  });

  it("is a no-op with size 0", async () => {
    const fake = fakeFactory();
    const pool = createWarmPool(fake.factory, { size: 0, languages: [LANGUAGES.PYTHON_ML] });
    await tick();
    expect(fake.created()).toBe(0);
    await pool.create(LANGUAGES.PYTHON_ML);
    expect(fake.created()).toBe(1);
    await pool.close();
  });
});
