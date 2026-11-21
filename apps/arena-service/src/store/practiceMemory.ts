import { randomUUID } from "node:crypto";
import type { PracticeStore, ProfileRecord, SessionRecord } from "./types.js";

const clone = <T>(v: T): T => structuredClone(v);

/** In-memory sessions and profiles for tests. Mirrors the Mongo store's rules. */
export function createPracticeMemoryStore(): PracticeStore {
  const sessions: SessionRecord[] = [];
  const profiles = new Map<string, ProfileRecord>();

  return {
    sessions: {
      async create(data) {
        const row = { ...clone(data), id: randomUUID() };
        sessions.push(row);
        return clone(row);
      },
      get: async (id) => clone(sessions.find((s) => s.id === id) ?? null),
      listForUser: async (userId, limit) =>
        sessions
          .filter((s) => s.userId === userId)
          .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
          .slice(0, limit)
          .map(clone),
      findOpen: async (userId, now) =>
        sessions.filter((s) => s.userId === userId && !s.finishedAt && s.endsAt > now).map(clone),
      async recordOutcome(id, itemId, event, at) {
        const s = sessions.find((x) => x.id === id);
        if (!s) return;
        const o = (s.outcomes[itemId] ??= { solvedAt: null, wrong: 0, revealed: false });
        if (o.solvedAt) return;
        if (event === "correct") o.solvedAt = at;
        else if (event === "wrong") o.wrong += 1;
        else o.revealed = true;
      },
      async finish(id, at) {
        const s = sessions.find((x) => x.id === id);
        if (s && !s.finishedAt) s.finishedAt = at;
      },
      listForSource: async (sourceId, rankedOnly) =>
        sessions.filter((s) => s.sourceId === sourceId && (!rankedOnly || s.ranked)).map(clone),
      latestForUserAndSource: async (userId, sourceId) =>
        clone(
          sessions
            .filter((s) => s.userId === userId && s.sourceId === sourceId)
            .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())[0] ?? null,
        ),
      countSince: async (userId, kind, since) =>
        sessions.filter((s) => s.userId === userId && s.kind === kind && s.startedAt >= since).length,
    },
    profiles: {
      get: async (userId) => clone(profiles.get(userId) ?? null),
      getByHandle: async (handle) => clone([...profiles.values()].find((p) => p.handle === handle) ?? null),
      getMany: async (userIds) => userIds.flatMap((id) => (profiles.has(id) ? [clone(profiles.get(id)!)] : [])),
      async upsert(data, at) {
        const taken = [...profiles.values()].find((p) => p.handle === data.handle && p.userId !== data.userId);
        if (taken) throw Object.assign(new Error("duplicate key"), { code: 11000 });
        const row = { ...clone(data), createdAt: profiles.get(data.userId)?.createdAt ?? at };
        profiles.set(data.userId, row);
        return clone(row);
      },
    },
  };
}
