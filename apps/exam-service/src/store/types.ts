import type {
  AttemptStatus,
  AuditEvent,
  BankQuery,
  Difficulty,
  ExamQuestion,
  ExamSection,
  ExamSettings,
  ExamStatus,
  LanguageId,
  ProctorEventType,
  ReevaluationStatus,
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
  sections: ExamSection[];
  questions: ExamQuestion[];
  /** Extra minutes per student (userId → minutes). */
  extraTime: Record<string, number>;
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
  /** Written answers. */
  text?: string;
  savedAt: Date;
  judge?: JudgeRecord;
}

/** Marks a grader gave; overrides the automatic score for that question. */
export interface GradeRecord {
  marks: number;
  rubricIds: string[];
  comment: string;
  gradedBy: string;
  gradedAt: Date;
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
  /** Grader marks per question (written answers, and overrides). */
  grades: Record<string, GradeRecord>;
  /** Per-question score once submitted; null = still being judged or graded. */
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

export interface ReevaluationRecord {
  id: string;
  examId: string;
  institutionId: string;
  attemptId: string;
  userId: string;
  questionId: string;
  reason: string;
  status: ReevaluationStatus;
  response: string;
  scoreBefore: number | null;
  scoreAfter: number | null;
  resolvedBy: string | null;
  resolvedAt: Date | null;
  createdAt: Date;
}

export interface BankQuestionRecord {
  id: string;
  institutionId: string;
  question: ExamQuestion;
  topic: string;
  tags: string[];
  difficulty: Difficulty | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
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
    /** Everything but openReevaluations (which comes from the reevaluations collection). */
    summarizeExam(examId: string): Promise<Omit<ResultSummary, "openReevaluations">>;
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
    /** Updates scores of an already-final attempt (late judge results, grading). */
    setScores(id: string, scores: Record<string, number | null>, score: number | null): Promise<void>;
    listExpiredInProgress(now: Date): Promise<AttemptRecord[]>;
    /** Sets (or with null, removes) one question's grade on a final attempt. Returns the updated attempt. */
    setGrade(id: string, questionId: string, grade: GradeRecord | null): Promise<AttemptRecord | null>;
    /** Moves the deadline of an attempt that is still in progress. */
    setDeadline(id: string, deadline: Date): Promise<void>;
    /** Among final, scored attempts: how many scored above and below `score`, and how many in all. */
    rankCounts(examId: string, score: number): Promise<{ above: number; below: number; total: number }>;
    /** Per question: final attempts with a non-blank answer, and how many of those are graded. */
    gradingCounts(examId: string, questionIds: string[]): Promise<Record<string, { answered: number; graded: number }>>;
    /** Final attempts with a non-blank answer to the question, oldest first. */
    pageForGrading(
      examId: string,
      questionId: string,
      query: { ungradedOnly: boolean; limit: number; cursor?: string },
    ): Promise<Page<AttemptRecord>>;
  };
  reevaluations: {
    /** Throws an error with code 11000 if this question already has a request on this attempt. */
    create(data: New<ReevaluationRecord>): Promise<ReevaluationRecord>;
    findById(id: string): Promise<ReevaluationRecord | null>;
    /** Oldest first, at most 500. */
    listForExam(examId: string, status?: ReevaluationStatus): Promise<ReevaluationRecord[]>;
    listForAttempt(attemptId: string): Promise<ReevaluationRecord[]>;
    countOpen(examId: string): Promise<number>;
    /** Resolves an open request. False if it was already resolved. */
    resolve(
      id: string,
      patch: Pick<ReevaluationRecord, "response" | "scoreAfter" | "resolvedBy" | "resolvedAt">,
    ): Promise<boolean>;
  };
  bank: {
    create(data: Omit<BankQuestionRecord, "id" | "createdAt" | "updatedAt">): Promise<BankQuestionRecord>;
    findById(id: string): Promise<BankQuestionRecord | null>;
    update(
      id: string,
      patch: Pick<BankQuestionRecord, "question" | "topic" | "tags" | "difficulty">,
    ): Promise<BankQuestionRecord | null>;
    delete(id: string): Promise<void>;
    /** Newest first, filtered. */
    page(institutionId: string, query: BankQuery): Promise<Page<BankQuestionRecord>>;
  };
  audit: {
    record(event: Omit<AuditEvent, "id" | "at">): Promise<void>;
    pageForInstitution(institutionId: string, query: { limit: number; cursor?: string }): Promise<Page<AuditEvent>>;
  };
}
