/**
 * Audit log: who did what, when. Written by each service into its own
 * database (append-only from code), read by institution owners/admins and
 * platform staff.
 */
export const AUDIT_ACTIONS = [
  // identity-service
  "institution.created",
  "member.joined",
  "member.role_changed",
  "member.batches_changed",
  "member.removed",
  "batch.created",
  "invite.created",
  "invite.revoked",
  // exam-service
  "exam.created",
  "exam.updated",
  "exam.published",
  "exam.unpublished",
  "exam.deleted",
  "exam.answer_graded",
  "exam.extra_time_set",
  "exam.reevaluation_requested",
  "exam.reevaluation_resolved",
  "bank_question.created",
  "bank_question.updated",
  "bank_question.deleted",
  // problem-service
  "problem.created",
  "problem.updated",
  "problem.deleted",
  "arena.track_assigned",
  "arena.track_unassigned",
  "institution.licence_changed",
  "institution.updated",
  "institution.status_changed",
  "institution.features_changed",
  "institution.contract_changed",
  "institution.owner_added",
  "institution.support_access",
  "department.created",
  "department.updated",
  "department.deleted",
  "batch.updated",
  "member.imported",
  "member.password_reset",
  "member.roll_number_changed",
  "join_request.created",
  "join_request.approved",
  "join_request.rejected",
  "batch.promoted",
  "billing.pro_granted",
  "billing.coupon_created",
  "billing.coupon_disabled",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export interface AuditEvent {
  id: string;
  at: string;
  /** User who performed the action. */
  actorId: string;
  action: AuditAction;
  /** Set for institution-scoped actions, so admins can see their institution's log. */
  institutionId: string | null;
  targetType: "institution" | "member" | "batch" | "invite" | "exam" | "attempt" | "bank_question" | "problem" | "track_assignment" | "user" | "coupon" | "department" | "join_request";
  targetId: string;
  /** Small, non-sensitive details (e.g. old and new role). Never passwords or answers. */
  meta: Record<string, unknown>;
}
