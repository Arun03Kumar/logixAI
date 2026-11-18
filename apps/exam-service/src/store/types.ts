import type {
  AttemptStatus,
  AuditEvent,
  ExamQuestion,
  ExamSettings,
  ExamStatus,
  LanguageId,
  ProctorEventType,
  ResultSummary,
} from "@logixai/contracts";

export interface ExamRecord {
  id: string;
  institutionId: string;
  title: string;
  instructions: string;
  durationMinutes: number;
  startsAt: Date | null;
  endsAt: Date | null;
  batchIds: string[];
  settings: ExamSettings;
  questions: ExamQuestion[];
  status: ExamStatus;
  createdBy: string;
  createdAt: Date;
  publishedAt: Date | null;
}

export interface JudgeRecord {
  submissionId: string;
  status: "pending" | "done" | "error";
  passed: number;
  total: number;
  message?: string;
  /** Hash of language + code that was judged. */
  codeHash: string;
  requestedAt: Date;
  judgedAt?: Date;
}

export interface AnswerRecord {
  selectedOptionIds?: string[];
  code?: string;
  language?: LanguageId;
  savedAt: Date;
  judge?: JudgeRecord;
}

export interface AttemptRecord {
  id: string;
  examId: string;
  institutionId: string;
  userId: string;
  status: AttemptStatus;
  startedAt: Date;
  deadline: Date;
  submittedAt: Date | null;
  /** Question ids in the order this student sees them. */
  questionOrder: string[];
  /** Option ids per MCQ question, in this student's order. */
  optionOrder: Record<string, string[]>;
  answers: Record<string, AnswerRecord>;
  /** Per-question score once submitted; null = still being judged. */
  scores: Record<string, number | null> | null;
  score: number | null;
  maxScore: number;
  proctorEvents: { type: ProctorEventType; at: Date }[];
  createdAt: Date;
}

/** The slice of an attempt the results table needs (no answers or code). */
export interface AttemptRow {
  id: string;
  userId: string;
  status: AttemptStatus;
  startedAt: Date;
  submittedAt: Date | null;
  score: number | null;
  maxScore: number;
  proctorEventCount: number;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

type New<T> = Omit<T, "id" | "createdAt">;

export interface Store {
  exams: {
    create(data: New<ExamRecord>): Promise<ExamRecord>;
    findById(id: string): Promise<ExamRecord | null>;
    listForInstitution(institutionId: string): Promise<ExamRecord[]>;
    update(id: string, patch: Partial<New<ExamRecord>>): Promise<ExamRecord | null>;
    delete(id: string): Promise<void>;
  };
  attempts: {
    /** Throws an error with code 11000 if this student already has an attempt. */
    create(data: New<AttemptRecord>): Promise<AttemptRecord>;
    findById(id: string): Promise<AttemptRecord | null>;
    find(examId: string, userId: string): Promise<AttemptRecord | null>;
    /** Best score first (unscored last), then oldest attempt first. */
    pageForExam(examId: string, query: { limit: number; cursor?: string }): Promise<Page<AttemptRow>>;
    summarizeExam(examId: string): Promise<ResultSummary>;
    listForUser(userId: string, examIds: string[]): Promise<AttemptRecord[]>;
    countForExam(examId: string): Promise<number>;
    /**
     * Merges fields into one answer while the attempt is in progress and its
     * deadline is later than `deadlineAfter` (now minus a small grace period).
     */
    saveAnswer(
      id: string,
      questionId: string,
      answer: Partial<AnswerRecord>,
      deadlineAfter: Date,
    ): Promise<boolean>;
    /** Stores a judge result only if it's for the answer's latest run. */
    setJudge(id: string, questionId: string, judge: JudgeRecord): Promise<boolean>;
    pushEvent(id: string, event: { type: ProctorEventType; at: Date }, max: number): Promise<void>;
    /** Moves an in-progress attempt to a final status. False if it was already final. */
    finalize(
      id: string,
      patch: Pick<AttemptRecord, "status" | "submittedAt" | "scores" | "score" | "answers">,
    ): Promise<boolean>;
    /** Updates scores of an already-final attempt (late judge results). */
    setScores(id: string, scores: Record<string, number | null>, score: number | null): Promise<void>;
    listExpiredInProgress(now: Date): Promise<AttemptRecord[]>;
  };
  audit: {
    record(event: Omit<AuditEvent, "id" | "at">): Promise<void>;
    pageForInstitution(institutionId: string, query: { limit: number; cursor?: string }): Promise<Page<AuditEvent>>;
  };
}
