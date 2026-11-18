import type { ArenaSubmissionStatus, ArenaTestResult, ItemStatus } from "@logixai/contracts";

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
  };
}
