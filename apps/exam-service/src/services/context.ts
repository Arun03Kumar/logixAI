import { ForbiddenError, NotFoundError } from "@logixai/service-kit";
import type { IdentityClient, Membership } from "../lib/identity.js";
import { isStaff } from "../lib/rules.js";
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
  return { exam, membership };
}

export async function requireMember(
  deps: Deps,
  caller: Caller,
  institutionId: string,
): Promise<Membership> {
  const membership = await deps.identity.getMembership(caller.authorization, institutionId);
  if (!membership) throw new NotFoundError("Institution", institutionId);
  return membership;
}

export function requireStaff(membership: Membership): void {
  if (!isStaff(membership.role)) {
    throw new ForbiddenError("Only instructors and admins can manage exams.");
  }
}
