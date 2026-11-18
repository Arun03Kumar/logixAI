const { SUBMISSION_STATUSES } = require("@logixai/contracts");

/**
 * Data migrations for submission-service, applied in id order by `npm run db:migrate`.
 * Never edit or rename a migration once it has run anywhere; add a new one.
 */
module.exports = [
  {
    id: "2026-11-18-01-status-field",
    description: "Early submissions stored their status in a misspelled `staus` field",
    async up(db) {
      const submissions = db.collection("submissions");
      for await (const s of submissions.find({ staus: { $exists: true } })) {
        const status = s.status ?? (SUBMISSION_STATUSES.includes(s.staus) ? s.staus : "Pending");
        await submissions.updateOne({ _id: s._id }, { $set: { status }, $unset: { staus: "" } });
      }
    },
  },
  {
    id: "2026-11-18-02-defaults",
    description: "Submissions created before run/submit modes: mark them as full submissions",
    async up(db) {
      await db
        .collection("submissions")
        .updateMany({ mode: { $exists: false } }, { $set: { mode: "submit", sampleCount: 0 } });
    },
  },
];
