import type { Migration } from "@logixai/service-kit";
import { ROLE_RANK } from "../store/types.js";

/**
 * Data migrations for identity-service, applied in id order by `npm run db:migrate`.
 * Never edit or rename a migration once it has run anywhere; add a new one.
 */
export const migrations: Migration[] = [
  {
    id: "2026-11-18-01-membership-role-rank",
    description: "Store each membership's role rank so members can be listed owners-first by the database",
    async up(db) {
      for (const [role, rank] of Object.entries(ROLE_RANK)) {
        await db.collection("memberships").updateMany({ role, roleRank: { $exists: false } }, { $set: { roleRank: rank } });
      }
    },
  },
  {
    id: "2026-11-19-01-six-roles",
    description: "Roles grew from four to six (department head, assistant): re-rank memberships and add department scopes",
    async up(db) {
      for (const [role, rank] of Object.entries(ROLE_RANK)) {
        await db.collection("memberships").updateMany({ role }, { $set: { roleRank: rank } });
      }
      await db.collection("memberships").updateMany({ departmentIds: { $exists: false } }, { $set: { departmentIds: [] } });
      await db.collection("institutions").updateMany({ status: { $exists: false } }, { $set: { status: "active" } });
    },
  },
  {
    id: "2026-11-19-02-optional-email",
    description: "Accounts may have no email (roll-number students): make the email index unique only for real emails",
    async up(db) {
      const users = db.collection("users");
      const indexes = await users.indexes().catch(() => []);
      const old = indexes.find((i) => i.name === "email_1" && !i.partialFilterExpression);
      // syncIndexes (right after migrations) creates the partial index in its place.
      if (old) await users.dropIndex("email_1");
    },
  },
];
