import type { LanguageDefinition } from "@logixai/contracts";
import type { Sandbox, SandboxFactory } from "./types.js";

/**
 * Keeps a few started, never-used sandboxes ready per language, so a
 * submission doesn't wait for a container to be created and started.
 *
 * Isolation is unchanged: every submission still gets its own fresh
 * container, which is destroyed afterwards (the judge calls destroy()). Taking
 * one from the pool just means it was started earlier. A replacement starts
 * in the background straight away.
 *
 * Sandboxes stop themselves after a few minutes (dockerSandbox
 * MAX_LIFETIME_SEC), so idle ones are replaced before `maxIdleMs`.
 */
export interface WarmPoolOptions {
  /** Ready sandboxes kept per language. 0 disables the pool for that language. */
  size: number;
  /** Languages to keep warm (others are created on demand). */
  languages: LanguageDefinition[];
  /** Replace idle sandboxes older than this (must stay below the sandbox's own lifetime). */
  maxIdleMs?: number;
  log?: (msg: string) => void;
}

interface Ready {
  sandbox: Sandbox;
  startedAt: number;
}

export interface WarmPool extends SandboxFactory {
  /** Ready sandboxes per language id (for /queue-stats and tests). */
  stats(): Record<string, number>;
  /** Stops refilling and destroys idle sandboxes (shutdown). */
  close(): Promise<void>;
}

export function createWarmPool(inner: SandboxFactory, options: WarmPoolOptions): WarmPool {
  const maxIdleMs = options.maxIdleMs ?? 200_000;
  const ready = new Map<string, Ready[]>();
  const starting = new Map<string, number>();
  let closed = false;

  const fill = (language: LanguageDefinition) => {
    if (closed || options.size <= 0) return;
    const list = ready.get(language.id) ?? [];
    ready.set(language.id, list);
    const missing = options.size - list.length - (starting.get(language.id) ?? 0);
    // "starting" goes down in the same step the sandbox joins the list, so a
    // refill in between can't see the pool as fuller than it is.
    const started = () => starting.set(language.id, Math.max(0, (starting.get(language.id) ?? 1) - 1));
    for (let i = 0; i < missing; i++) {
      starting.set(language.id, (starting.get(language.id) ?? 0) + 1);
      inner.create(language).then(
        (sandbox) => {
          started();
          if (closed) {
            sandbox.destroy().catch(() => {});
            return;
          }
          list.push({ sandbox, startedAt: Date.now() });
        },
        (err: Error) => {
          started();
          options.log?.(`Warm sandbox for ${language.id} failed to start: ${err.message}`);
        },
      );
    }
  };

  // Replace sandboxes that have been idle too long, before they stop themselves.
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const language of options.languages) {
      const list = ready.get(language.id) ?? [];
      const stale = list.filter((r) => now - r.startedAt > maxIdleMs);
      if (!stale.length) continue;
      ready.set(
        language.id,
        list.filter((r) => !stale.includes(r)),
      );
      for (const r of stale) r.sandbox.destroy().catch(() => {});
      fill(language);
    }
  }, 30_000);
  sweep.unref();

  for (const language of options.languages) fill(language);

  return {
    async create(language) {
      const list = ready.get(language.id);
      const now = Date.now();
      while (list?.length) {
        const r = list.shift()!;
        if (now - r.startedAt <= maxIdleMs) {
          fill(language);
          return r.sandbox;
        }
        r.sandbox.destroy().catch(() => {});
      }
      // Nothing ready (pool off for this language, or a burst used it up).
      if (options.languages.some((l) => l.id === language.id)) fill(language);
      return inner.create(language);
    },
    stats() {
      return Object.fromEntries([...ready.entries()].map(([id, list]) => [id, list.length]));
    },
    async close() {
      closed = true;
      clearInterval(sweep);
      const all = [...ready.values()].flat();
      ready.clear();
      await Promise.all(all.map((r) => r.sandbox.destroy().catch(() => {})));
    },
  };
}
