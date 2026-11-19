import { ForbiddenError, NotFoundError } from "@logixai/service-kit";
import type { Capability } from "@logixai/contracts";
import type { IdentityClient, Membership } from "../lib/identity.js";
import type { ExamRecord, Store } from "../store/types.js";

/** Who is calling: their user id and the raw Authorization header to forward. */
export interface Caller {
  userId: string;
  authorization: string;
}

export interface Deps {
  store: Store;
  identity: IdentityClient;
}

function requireExamsEnabled(membership: Membership) {
  if (!membership.features.exams) {
    throw new ForbiddenError("Exams aren't switched on for this institution. Contact LogixAI to enable them.");
  }
}

/** Loads the exam and the caller's membership in its institution. */
export async function loadExamFor(
  deps: Deps,
  caller: Caller,
  examId: string,
): Promise<{ exam: ExamRecord; membership: Membership }> {
  const exam = await deps.store.exams.findById(examId);
  const membership = exam
    ? await deps.identity.getMembership(caller.authorization, exam.institutionId)
    : null;
  // Same 404 whether the exam is missing or belongs to someone else's institution.
  if (!exam || !membership) throw new NotFoundError("Exam", examId);
  requireExamsEnabled(membership);
  return { exam, membership };
}

export async function requireMember(deps: Deps, caller: Caller, institutionId: string): Promise<Membership> {
  const membership = await deps.identity.getMembership(caller.authorization, institutionId);
  if (!membership) throw new NotFoundError("Institution", institutionId);
  requireExamsEnabled(membership);
  return membership;
}

/** Staff views (results, exam lists) are for anyone who can see reports, assistants included. */
export const isStaffView = (m: Membership) => m.capabilities.includes("reports.view");

export function requireCapability(m: Membership, capability: Capability): void {
  if (!m.capabilities.includes(capability)) {
    throw new ForbiddenError(
      capability === "tests.manage"
        ? "Only instructors, department heads and admins can manage exams."
        : "You don't have access to this.",
    );
  }
}

/** Staff limited to some batches see exams for those batches, and exams they created. */
export function canSeeExam(m: Membership, exam: Pick<ExamRecord, "batchIds" | "createdBy">, userId: string): boolean {
  return m.scope.all || exam.createdBy === userId || exam.batchIds.some((b) => m.scope.batchIds.includes(b));
}

/** The capability, and the exam within the caller's scope (else the same 404 as a missing exam). */
export function requireExam(m: Membership, exam: ExamRecord, caller: Caller, capability: Capability): void {
  requireCapability(m, capability);
  if (!canSeeExam(m, exam, caller.userId)) throw new NotFoundError("Exam", exam.id);
}
