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
  const departments = table<import("./types.js").DepartmentRecord>();
  const joinRequests = table<import("./types.js").JoinRequestRecord>();
  const auditLog: AuditEvent[] = [];
  const grants = new Set<string>();
  const DAY_MS = 24 * 60 * 60 * 1000;

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
        if (data.email && [...users.values()].some((u) => u.email === data.email)) {
          throw Object.assign(new Error("duplicate key"), { code: 11000 });
        }
        return insert(users, data);
      },
      findById: async (id) => copy(users.get(id)),
      findByEmail: async (email) => copy([...users.values()].find((u) => u.email !== null && u.email === email)),
      findByIds: async (ids) => all(users).filter((u) => ids.includes(u.id)),
      findByEmails: async (emails) => all(users).filter((u) => u.email !== null && emails.includes(u.email)),
      async update(id, patch) {
        const u = users.get(id);
        if (!u) return null;
        Object.assign(u, patch);
        return { ...u };
      },
      async touchLastSeen(userId, at) {
        const u = users.get(userId);
        if (u) u.lastSeenAt = at;
      },
      async extendPro(userId, days, now) {
        const u = users.get(userId);
        if (!u) return null;
        const from = u.proUntil && u.proUntil > now ? u.proUntil : now;
        u.proUntil = new Date(from.getTime() + days * DAY_MS);
        return u.proUntil;
      },
    },
    entitlements: {
      async recordGrant(grant) {
        if (grants.has(grant.reference)) return false;
        grants.add(grant.reference);
        return true;
      },
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
      findBySlug: async (slug) => copy([...institutions.values()].find((i) => i.slug === slug)),
      findByEmailDomain: async (domain) =>
        all(institutions).filter((i) => (i.status ?? "active") === "active" && (i.emailDomains ?? []).includes(domain)),
      async setLicence(id, until, seats) {
        const inst = institutions.get(id);
        if (!inst) return null;
        Object.assign(inst, { licenceUntil: until, licenceSeats: seats });
        return { ...inst };
      },
      async update(id, patch) {
        const inst = institutions.get(id);
        if (!inst) return null;
        Object.assign(inst, patch);
        return { ...inst };
      },
      search: async (query, limit) =>
        all(institutions)
          .filter((i) => !query || `${i.name} ${i.slug}`.toLowerCase().includes(query.toLowerCase()))
          .reverse()
          .slice(0, limit),
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
        if (data.rollNumber && [...memberships.values()].some((m) => m.institutionId === data.institutionId && m.rollNumber === data.rollNumber)) {
          throw Object.assign(new Error("duplicate key"), { code: 11000 });
        }
        return insert(memberships, data);
      },
      findByRollNumber: async (institutionId, rollNumber) =>
        copy([...memberships.values()].find((m) => m.institutionId === institutionId && m.rollNumber === rollNumber)),
      findByRollNumbers: async (institutionId, rollNumbers) =>
        all(memberships).filter((m) => m.institutionId === institutionId && m.rollNumber && rollNumbers.includes(m.rollNumber)),
      findForUsers: async (institutionId, userIds) =>
        all(memberships).filter((m) => m.institutionId === institutionId && userIds.includes(m.userId)),
      find: async (userId, institutionId) =>
        copy(
          [...memberships.values()].find(
            (m) => m.userId === userId && m.institutionId === institutionId,
          ),
        ),
      listForUser: async (userId) => all(memberships).filter((m) => m.userId === userId),
      async roleCounts(institutionIds) {
        const out: Record<string, Record<string, number>> = {};
        for (const m of memberships.values()) {
          if (!institutionIds.includes(m.institutionId)) continue;
          const row = (out[m.institutionId] ??= {});
          row[m.role] = (row[m.role] ?? 0) + 1;
        }
        return out;
      },
      async activeSince(institutionIds, since) {
        const out: Record<string, number> = {};
        for (const m of memberships.values()) {
          const u = users.get(m.userId);
          if (institutionIds.includes(m.institutionId) && u?.lastSeenAt && u.lastSeenAt >= since) {
            out[m.institutionId] = (out[m.institutionId] ?? 0) + 1;
          }
        }
        return out;
      },
      async countForInstitutions(institutionIds) {
        const counts: Record<string, number> = {};
        for (const m of memberships.values()) {
          if (institutionIds.includes(m.institutionId)) counts[m.institutionId] = (counts[m.institutionId] ?? 0) + 1;
        }
        return counts;
      },
      async pageForInstitution(institutionId, { limit, cursor, role, userIds, batchId, batchIds }) {
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
              (!batchId || m.batchIds.includes(batchId)) &&
              (!batchIds || m.batchIds.some((b) => batchIds.includes(b))),
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
        if (
          patch.rollNumber &&
          [...memberships.values()].some((o) => o.id !== id && o.institutionId === m.institutionId && o.rollNumber === patch.rollNumber)
        ) {
          throw Object.assign(new Error("duplicate key"), { code: 11000 });
        }
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
      countSeatedStudents: async (institutionId, archived) =>
        [...memberships.values()].filter(
          (m) =>
            m.institutionId === institutionId &&
            m.role === "student" &&
            (m.batchIds.length === 0 || m.batchIds.some((b) => !archived.includes(b))),
        ).length,
      async moveBatch(institutionId, from, to, userIds) {
        let moved = 0;
        for (const m of memberships.values()) {
          if (m.institutionId !== institutionId || m.role !== "student" || !m.batchIds.includes(from)) continue;
          if (userIds && !userIds.includes(m.userId)) continue;
          m.batchIds = [...new Set([...m.batchIds.filter((b) => b !== from), to])];
          moved++;
        }
        return moved;
      },
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
      async update(id, patch) {
        const b = batches.get(id);
        if (!b) return null;
        Object.assign(b, patch);
        return { ...b };
      },
    },
    departments: {
      async create(data) {
        const taken = [...departments.values()].some(
          (d) => d.institutionId === data.institutionId && d.name.toLowerCase() === data.name.toLowerCase(),
        );
        if (taken) throw Object.assign(new Error("duplicate key"), { code: 11000 });
        return insert(departments, data);
      },
      findById: async (id) => copy(departments.get(id)),
      listForInstitution: async (institutionId) =>
        all(departments)
          .filter((d) => d.institutionId === institutionId)
          .sort((a, b) => a.name.localeCompare(b.name)),
      async update(id, patch) {
        const d = departments.get(id);
        if (!d) return null;
        Object.assign(d, patch);
        return { ...d };
      },
      async delete(id) {
        departments.delete(id);
      },
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
    joinRequests: {
      async create(data) {
        if ([...joinRequests.values()].some((r) => r.status === "pending" && r.userId === data.userId && r.institutionId === data.institutionId)) {
          throw Object.assign(new Error("duplicate key"), { code: 11000 });
        }
        return insert(joinRequests, data);
      },
      findById: async (id) => copy(joinRequests.get(id)),
      listForInstitution: async (institutionId, status, limit) =>
        all(joinRequests)
          .filter((r) => r.institutionId === institutionId && r.status === status)
          .reverse()
          .slice(0, limit),
      pendingForUser: async (userId) => all(joinRequests).filter((r) => r.userId === userId && r.status === "pending"),
      async decide(id, status, by, at) {
        const r = joinRequests.get(id);
        if (!r || r.status !== "pending") return null;
        Object.assign(r, { status, decidedBy: by, decidedAt: at });
        return { ...r };
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
