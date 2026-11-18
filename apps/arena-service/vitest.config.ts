import { defineConfig } from "vitest/config";

// The first test pays for loading Fastify + Mongoose; give it room when
// every workspace runs its tests in parallel under turbo.
export default defineConfig({ test: { testTimeout: 15_000 } });
