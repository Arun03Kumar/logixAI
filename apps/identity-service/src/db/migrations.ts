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
];
