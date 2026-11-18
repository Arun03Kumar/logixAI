const { LEGACY_SAMPLE_COUNT } = require("@logixai/contracts");

/**
 * Data migrations for problem-service, applied in id order by `npm run db:migrate`.
 * Never edit or rename a migration once it has run anywhere; add a new one.
 */
module.exports = [
  {
    id: "2026-11-18-01-explicit-sample-tests",
    description:
      "Problems created before sample tests existed: move their first tests into sampleTestCases",
    async up(db) {
      const problems = db.collection("problems");
      const legacy = problems.find({
        $or: [{ sampleTestCases: { $exists: false } }, { sampleTestCases: { $size: 0 } }],
        "testCases.0": { $exists: true },
      });
      for await (const p of legacy) {
        await problems.updateOne(
          { _id: p._id },
          {
            $set: {
              sampleTestCases: p.testCases.slice(0, LEGACY_SAMPLE_COUNT),
              testCases: p.testCases.slice(LEGACY_SAMPLE_COUNT),
            },
          },
        );
      }
    },
  },
  {
    id: "2026-11-18-02-timestamps",
    description: "Give problems created before timestamps a createdAt/updatedAt from their id",
    async up(db) {
      const problems = db.collection("problems");
      for await (const p of problems.find({ createdAt: { $exists: false } })) {
        const at = p._id.getTimestamp();
        await problems.updateOne({ _id: p._id }, { $set: { createdAt: at, updatedAt: at } });
      }
    },
  },
];
