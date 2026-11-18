import { defineConfig } from "vitest/config";

// The first test pays for loading Fastify + Mongoose; give it room when
// every workspace runs its tests in parallel under turbo. The first beforeEach
// (building the app) pays it too, so hooks get the same headroom.
export default defineConfig({ test: { testTimeout: 15_000, hookTimeout: 30_000 } });
