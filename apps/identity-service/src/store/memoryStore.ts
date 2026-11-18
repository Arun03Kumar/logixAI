import { randomUUID } from "node:crypto";
import type { AuditEvent } from "@logixai/contracts";
import { decodeCursor, encodeCursor } from "@logixai/service-kit";
import { ROLE_RANK, type Store } from "./types.js";

/** In-memory Store for tests and local experiments. Not for production. */
export function createMemoryStore(): Store {
  const table = <T extends { id: string; createdAt: Date }>() => new Map<string, T>();
  const users = table<import("./types.js").UserRecord>();
  const tokens = table<import("./types.js").RefreshTokenRecord>();
  const institutions = table<import("./types.js").InstitutionRecord>();
  const memberships = table<import("./types.js").MembershipRecord>();
  const batches = table<import("./types.js").BatchRecord>();
  const invites = table<import("./types.js").InviteRecord>();
  const auditLog: AuditEvent[] = [];

  function insert<T extends { id: string; createdAt: Date }>(
    map: Map<string, T>,
    data: Omit<T, "id" | "createdAt">,
  ): T {
    const row = { ...data, id: randomUUID(), createdAt: new Date() } as T;
    map.set(row.id, row);
    return { ...row };
  }
  const copy = <T>(row: T | undefined): T | null => (row ? { ...row } : null);
  const all = <T>(map: Map<string, T>) => [...map.values()].map((r) => ({ ...r }));

  return {
    users: {
      async create(data) {
        if ([...users.values()].some((u) => u.email === data.email)) {
          throw Object.assign(new Error("duplicate key"), { code: 11000 });
        }
        return insert(users, data);
      },
      findById: async (id) => copy(users.get(id)),
      findByEmail: async (email) => copy([...users.values()].find((u) => u.email === email)),
      findByIds: async (ids) => all(users).filter((u) => ids.includes(u.id)),
    },
    refreshTokens: {
      create: async (data) => insert(tokens, data),
      findByHash: async (hash) => copy([...tokens.values()].find((t) => t.tokenHash === hash)),
      async revoke(id) {
        const t = tokens.get(id);
        if (!t || t.revokedAt) return false;
        t.revokedAt = new Date();
        return true;
      },
      async revokeAllForUser(userId) {
        for (const t of tokens.values()) {
          if (t.userId === userId && !t.revokedAt) t.revokedAt = new Date();
        }
      },
    },
    institutions: {
      create: async (data) => insert(institutions, data),
      findById: async (id) => copy(institutions.get(id)),
      findByIds: async (ids) => all(institutions).filter((i) => ids.includes(i.id)),
      slugExists: async (slug) => [...institutions.values()].some((i) => i.slug === slug),
    },
    memberships: {
      async create(data) {
        if (
          [...memberships.values()].some(
            (m) => m.userId === data.userId && m.institutionId === data.institutionId,
          )
        ) {
          throw Object.assign(new Error("duplicate key"), { code: 11000 });
        }
        return insert(memberships, data);
      },
      find: async (userId, institutionId) =>
        copy(
          [...memberships.values()].find(
            (m) => m.userId === userId && m.institutionId === institutionId,
          ),
        ),
      listForUser: async (userId) => all(memberships).filter((m) => m.userId === userId),
      async pageForInstitution(institutionId, { limit, cursor, role, userIds, batchId }) {
        // Same order as MongoStore: highest role first, then join order.
        const order = [...memberships.keys()];
        const key = (m: { id: string; role: keyof typeof ROLE_RANK }) =>
          [ROLE_RANK[m.role], order.indexOf(m.id)] as const;
        const after = decodeCursor(
          cursor,
          (v): v is [number, number] => Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === "number"),
        );
        const rows = all(memberships)
          .filter(
            (m) =>
              m.institutionId === institutionId &&
              (!role || m.role === role) &&
              (!userIds || userIds.includes(m.userId)) &&
              (!batchId || m.batchIds.includes(batchId)),
          )
          .sort((a, b) => key(b)[0] - key(a)[0] || key(a)[1] - key(b)[1])
          .filter((m) => {
            if (!after) return true;
            const [rank, seq] = key(m);
            return rank < after[0] || (rank === after[0] && seq > after[1]);
          });
        const items = rows.slice(0, limit);
        const last = items[items.length - 1];
        return {
          items,
          nextCursor:
            rows.length > limit && last
              ? encodeCursor(key(last))
              : null,
        };
      },
      async countByBatch(institutionId) {
        const counts: Record<string, number> = {};
        for (const m of memberships.values()) {
          if (m.institutionId !== institutionId) continue;
          for (const b of m.batchIds) counts[b] = (counts[b] ?? 0) + 1;
        }
        return counts;
      },
      async update(id, patch) {
        const m = memberships.get(id);
        if (!m) return null;
        Object.assign(m, patch);
        return { ...m };
      },
      async addBatch(id, batchId) {
        const m = memberships.get(id);
        if (m && !m.batchIds.includes(batchId)) m.batchIds = [...m.batchIds, batchId];
      },
      async delete(id) {
        memberships.delete(id);
      },
      countByRole: async (institutionId, role) =>
        [...memberships.values()].filter(
          (m) => m.institutionId === institutionId && m.role === role,
        ).length,
    },
    batches: {
      create: async (data) => insert(batches, data),
      findById: async (id) => copy(batches.get(id)),
      findByName: async (institutionId, name) =>
        copy(
          [...batches.values()].find(
            (b) =>
              b.institutionId === institutionId && b.name.toLowerCase() === name.toLowerCase(),
          ),
        ),
      listForInstitution: async (institutionId) =>
        all(batches).filter((b) => b.institutionId === institutionId),
    },
    invites: {
      create: async (data) => insert(invites, data),
      findById: async (id) => copy(invites.get(id)),
      findByCode: async (code) => copy([...invites.values()].find((i) => i.code === code)),
      listForInstitution: async (institutionId) =>
        all(invites).filter((i) => i.institutionId === institutionId),
      async consumeUse(id) {
        const i = invites.get(id);
        if (!i || (i.maxUses !== null && i.uses >= i.maxUses)) return false;
        i.uses += 1;
        return true;
      },
      async revoke(id) {
        const i = invites.get(id);
        if (i) i.revokedAt = new Date();
      },
    },
    audit: {
      async record(event) {
        auditLog.push({ ...structuredClone(event), id: randomUUID(), at: new Date().toISOString() });
      },
      async pageForInstitution(institutionId, { limit, cursor }) {
        const start = decodeCursor(cursor, (v): v is number => Number.isInteger(v) && (v as number) >= 0) ?? 0;
        const rows = auditLog.filter((e) => e.institutionId === institutionId).reverse();
        const items = rows.slice(start, start + limit);
        return {
          items,
          nextCursor:
            rows.length > start + limit ? encodeCursor(start + limit) : null,
        };
      },
    },
  };
}
