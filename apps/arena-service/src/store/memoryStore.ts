import { randomUUID } from "node:crypto";
import { decodeCursor, encodeCursor } from "@logixai/service-kit";
import type { AuditEvent } from "@logixai/contracts";
import type { AssignmentRecord, ProgressRecord, StatsRecord, Store, SubmissionRecord } from "./types.js";

const clone = <T>(v: T): T => structuredClone(v);

/** In-memory Store for tests. Mirrors MongoStore's conditional updates. */
export function createMemoryStore(): Store {
  const progress = new Map<string, ProgressRecord>();
  const submissions: SubmissionRecord[] = [];
  const stats = new Map<string, StatsRecord>();
  const assignments: AssignmentRecord[] = [];
  const auditLog: AuditEvent[] = [];
  const key = (u: string, i: string) => `${u}|${i}`;

  return {
    progress: {
      get: async (u, i) => (progress.has(key(u, i)) ? clone(progress.get(key(u, i))!) : null),
      listForUser: async (u) => [...progress.values()].filter((p) => p.userId === u).map(clone),
      async recordAttempt(u, i, lastAnswer, at) {
        const row = progress.get(key(u, i)) ?? {
          userId: u,
          itemId: i,
          status: "attempted" as const,
          attempts: 0,
          lastAnswer: null,
          xp: 0,
          solvedAt: null,
          revealedAt: null,
          lastActivityAt: at,
        };
        row.attempts += 1;
        row.lastAnswer = clone(lastAnswer);
        row.lastActivityAt = at;
        progress.set(key(u, i), row);
        return clone(row);
      },
      async markSolved(u, i, xp, at) {
        const row = progress.get(key(u, i));
        if (row?.status === "solved") return "solved";
        const before = row?.status ?? null;
        progress.set(key(u, i), {
          userId: u,
          itemId: i,
          attempts: row?.attempts ?? 1,
          lastAnswer: row?.lastAnswer ?? null,
          revealedAt: row?.revealedAt ?? null,
          status: "solved",
          xp,
          solvedAt: at,
          lastActivityAt: at,
        });
        return before;
      },
      async markRevealed(u, i, at) {
        const row = progress.get(key(u, i));
        if (row?.status === "solved") return false;
        progress.set(key(u, i), {
          userId: u,
          itemId: i,
          attempts: row?.attempts ?? 0,
          lastAnswer: row?.lastAnswer ?? null,
          xp: 0,
          solvedAt: null,
          status: "revealed",
          revealedAt: at,
          lastActivityAt: at,
        });
        return true;
      },
      async setReview(u, i, review) {
        const row = progress.get(key(u, i));
        if (row) row.review = clone(review);
      },
      listForUsers: async (userIds, itemIds) =>
        [...progress.values()].filter((p) => userIds.includes(p.userId) && itemIds.includes(p.itemId)).map(clone),
    },
    submissions: {
      async create(data) {
        const row = { ...clone(data), id: randomUUID() };
        submissions.push(row);
        return clone(row);
      },
      get: async (id) => clone(submissions.find((s) => s.id === id) ?? null),
      async complete(id, result) {
        const row = submissions.find((s) => s.id === id);
        if (!row || row.status !== "pending") return null;
        Object.assign(row, clone(result));
        return clone(row);
      },
      async setXp(id, xp) {
        const row = submissions.find((s) => s.id === id);
        if (row) row.xpGained = xp;
      },
      async pageForUser(u, { limit, cursor, itemId }) {
        const start = decodeCursor(cursor, (v): v is number => Number.isInteger(v) && (v as number) >= 0) ?? 0;
        const rows = submissions.filter((s) => s.userId === u && (!itemId || s.itemId === itemId)).reverse();
        return {
          items: rows.slice(start, start + limit).map(clone),
          nextCursor: rows.length > start + limit ? encodeCursor(start + limit) : null,
        };
      },
      countSince: async (u, since) => submissions.filter((s) => s.userId === u && s.createdAt >= since).length,
      countPendingSince: async (u, since) =>
        submissions.filter((s) => s.userId === u && s.status === "pending" && s.createdAt > since).length,
      async submitStats(u) {
        const done = submissions.filter((s) => s.userId === u && s.mode === "submit" && s.status !== "pending");
        return { total: done.length, passed: done.filter((s) => s.status === "passed").length };
      },
    },
    stats: {
      get: async (u) => clone(stats.get(u) ?? null),
      async record(u, day, change) {
        const row = stats.get(u) ?? { userId: u, xp: 0, solvedCount: 0, days: {} };
        row.xp += change.xp;
        row.solvedCount += change.solved;
        row.days[day] = (row.days[day] ?? 0) + change.solved;
        stats.set(u, row);
      },
      getMany: async (userIds) => [...stats.values()].filter((s) => userIds.includes(s.userId)).map(clone),
    },
    assignments: {
      async create(data) {
        if (assignments.some((a) => a.institutionId === data.institutionId && a.batchId === data.batchId && a.trackId === data.trackId)) {
          throw Object.assign(new Error("duplicate key"), { code: 11000 });
        }
        const row = { ...clone(data), id: randomUUID() };
        assignments.push(row);
        return clone(row);
      },
      get: async (id) => clone(assignments.find((a) => a.id === id) ?? null),
      async delete(id) {
        const i = assignments.findIndex((a) => a.id === id);
        if (i >= 0) assignments.splice(i, 1);
      },
      listForInstitution: async (institutionId, batchIds) =>
        assignments
          .filter((a) => a.institutionId === institutionId && (!batchIds || batchIds.includes(a.batchId)))
          .reverse()
          .map(clone),
    },
    audit: {
      async record(event) {
        auditLog.push({ ...clone(event), id: randomUUID(), at: new Date().toISOString() });
      },
      async pageForInstitution(institutionId, { limit, cursor }) {
        const start = decodeCursor(cursor, (v): v is number => Number.isInteger(v) && (v as number) >= 0) ?? 0;
        const rows = auditLog.filter((e) => e.institutionId === institutionId).reverse();
        return {
          items: rows.slice(start, start + limit).map(clone),
          nextCursor: rows.length > start + limit ? encodeCursor(start + limit) : null,
        };
      },
    },
  };
}
