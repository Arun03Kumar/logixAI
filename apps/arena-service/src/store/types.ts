import type { ArenaSubmissionStatus, ArenaTestResult, AuditEvent, ItemStatus } from "@logixai/contracts";

export interface ProgressRecord {
  userId: string;
  itemId: string;
  status: ItemStatus;
  attempts: number;
  /** Last answer (mcq/numeric/output) or last code (code/debug), to restore the page. */
  lastAnswer: unknown;
  xp: number;
  solvedAt: Date | null;
  revealedAt: Date | null;
  lastActivityAt: Date;
  /** Spaced repetition: set on the first solve. */
  review?: ReviewRecord | null;
}

export interface ReviewRecord {
  due: Date;
  intervalDays: number;
}

export interface AssignmentRecord {
  id: string;
  institutionId: string;
  batchId: string;
  trackId: string;
  dueAt: Date | null;
  assignedBy: string;
  createdAt: Date;
}

export interface SubmissionRecord {
  id: string;
  userId: string;
  itemId: string;
  mode: "run" | "submit";
  code: string;
  status: ArenaSubmissionStatus;
  passed: number;
  total: number;
  tests: ArenaTestResult[];
  xpGained: number;
  createdAt: Date;
  judgedAt: Date | null;
}

export interface StatsRecord {
  userId: string;
  xp: number;
  solvedCount: number;
  /** "YYYY-MM-DD" (Asia/Kolkata) -> items solved that day. 0 = practiced, solved nothing. */
  days: Record<string, number>;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface Store {
  progress: {
    get(userId: string, itemId: string): Promise<ProgressRecord | null>;
    listForUser(userId: string): Promise<ProgressRecord[]>;
    /** Counts an attempt and stores the answer. Creates the row as "attempted" if new. */
    recordAttempt(userId: string, itemId: string, lastAnswer: unknown, at: Date): Promise<ProgressRecord>;
    /**
     * Marks solved unless already solved. Returns the status it had before
     * (null if new), or "solved" when nothing changed. `xp` is stored only on
     * the transition.
     */
    markSolved(userId: string, itemId: string, xp: number, at: Date): Promise<ItemStatus | null>;
    /** Marks revealed unless solved. Returns false if it was already solved. */
    markRevealed(userId: string, itemId: string, at: Date): Promise<boolean>;
    setReview(userId: string, itemId: string, review: ReviewRecord | null): Promise<void>;
    /** Batch reports: the given users' rows for the given items. */
    listForUsers(userIds: string[], itemIds: string[]): Promise<ProgressRecord[]>;
  };
  submissions: {
    create(data: Omit<SubmissionRecord, "id">): Promise<SubmissionRecord>;
    get(id: string): Promise<SubmissionRecord | null>;
    /** Stores the judge's result if the submission is still pending. */
    complete(
      id: string,
      result: Pick<SubmissionRecord, "status" | "passed" | "total" | "tests" | "judgedAt">,
    ): Promise<SubmissionRecord | null>;
    setXp(id: string, xp: number): Promise<void>;
    pageForUser(userId: string, query: { limit: number; cursor?: string; itemId?: string }): Promise<Page<SubmissionRecord>>;
    countPendingSince(userId: string, since: Date): Promise<number>;
    /** Submissions in "submit" mode and how many passed. */
    submitStats(userId: string): Promise<{ total: number; passed: number }>;
  };
  stats: {
    get(userId: string): Promise<StatsRecord | null>;
    /** Adds XP / solved items and marks the day as practiced. */
    record(userId: string, day: string, change: { xp: number; solved: number }): Promise<void>;
    getMany(userIds: string[]): Promise<StatsRecord[]>;
  };
  assignments: {
    /** Throws an error with code 11000 if the track is already assigned to the batch. */
    create(data: Omit<AssignmentRecord, "id">): Promise<AssignmentRecord>;
    get(id: string): Promise<AssignmentRecord | null>;
    delete(id: string): Promise<void>;
    /** Newest first; optionally only these batches. */
    listForInstitution(institutionId: string, batchIds?: string[]): Promise<AssignmentRecord[]>;
  };
  audit: {
    record(event: Omit<AuditEvent, "id" | "at">): Promise<void>;
    pageForInstitution(institutionId: string, query: { limit: number; cursor?: string }): Promise<Page<AuditEvent>>;
  };
}
