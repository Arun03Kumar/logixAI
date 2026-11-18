const mongoose = require("mongoose");
const { AUDIT_ACTIONS } = require("@logixai/contracts");

/** Append-only record of catalogue changes (see packages/contracts/src/audit.ts). */
const auditEventSchema = new mongoose.Schema(
  {
    at: { type: Date, required: true, default: () => new Date() },
    actorId: { type: String, required: true },
    action: { type: String, enum: AUDIT_ACTIONS, required: true },
    institutionId: { type: String, default: null },
    targetType: { type: String, required: true },
    targetId: { type: String, required: true },
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { collection: "audit_events", versionKey: false, minimize: false },
);
auditEventSchema.index({ targetId: 1, at: -1 });
auditEventSchema.index({ actorId: 1, at: -1 });

module.exports = mongoose.model("AuditEvent", auditEventSchema);
