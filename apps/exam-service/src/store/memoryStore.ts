import { randomUUID } from "node:crypto";
import type { AuditEvent } from "@logixai/contracts";
import { decodeCursor, encodeCursor } from "@logixai/service-kit";
import type { AttemptRecord, BankQuestionRecord, ExamRecord, ReevaluationRecord, Store } from "./types.js";

const offsetCursor = (cursor: string | undefined) =>
  decodeCursor(cursor, (v): v is number => Number.isInteger(v) && (v as number) >= 0) ?? 0;

const clone = <T>(value: T): T => structuredClone(value);

/** In-memory Store for tests. Mirrors MongoStore's conditional updates. */
export function createMemoryStore(): Store {
  const exams = new Map<string, ExamRecord>();
  const attempts = new Map<string, AttemptRecord>();
  const auditLog: AuditEvent[] = [];
  const reevaluations = new Map<string, ReevaluationRecord>();
  const bank = new Map<string, BankQuestionRecord>();
  const isFinal = (a: AttemptRecord) => a.status !== "in_progress";
  const answered = (a: AttemptRecord, questionId: string) => Boolean(a.answers[questionId]?.text?.trim());

  return {
    exams: {
      async create(data) {
        const row = { ...clone(data), id: randomUUID(), createdAt: new Date() };
        exams.set(row.id, row);
        return clone(row);
      },
      findById: async (id) => (exams.has(id) ? clone(exams.get(id)!) : null),
      listForInstitution: async (institutionId) =>
        [...exams.values()].filter((e) => e.institutionId === institutionId).map(clone),
      async update(id, patch) {
        const row = exams.get(id);
        if (!row) return null;
        Object.assign(row, clone(patch));
        return clone(row);
      },
      async delete(id) {
        exams.delete(id);
      },
    },
    attempts: {
      async create(data) {
        if ([...attempts.values()].some((a) => a.examId === data.examId && a.userId === data.userId)) {
          throw Object.assign(new Error("duplicate key"), { code: 11000 });
        }
        const row = { ...clone(data), id: randomUUID(), createdAt: new Date() };
        attempts.set(row.id, row);
        return clone(row);
      },
      findById: async (id) => (attempts.has(id) ? clone(attempts.get(id)!) : null),
      find: async (examId, userId) => {
        const row = [...attempts.values()].find((a) => a.examId === examId && a.userId === userId);
        return row ? clone(row) : null;
      },
      async pageForExam(examId, { limit, cursor }) {
        // Same order as MongoStore: score desc (unscored last), then creation order.
        const order = [...attempts.keys()];
        const rank = (a: AttemptRecord) => [a.score ?? -Infinity, order.indexOf(a.id)] as const;
        const start = offsetCursor(cursor);
        const rows = [...attempts.values()]
          .filter((a) => a.examId === examId)
          .sort((x, y) => rank(y)[0] - rank(x)[0] || rank(x)[1] - rank(y)[1]);
        return {
          items: rows.slice(start, start + limit).map((a) => ({
            id: a.id,
            userId: a.userId,
            status: a.status,
            startedAt: a.startedAt,
            submittedAt: a.submittedAt,
            score: a.score,
            maxScore: a.maxScore,
            proctorEventCount: a.proctorEvents.length,
          })),
          nextCursor: rows.length > start + limit ? encodeCursor(start + limit) : null,
        };
      },
      async summarizeExam(examId) {
        const rows = [...attempts.values()].filter((a) => a.examId === examId);
        const scores = rows
          .filter((a) => a.status !== "in_progress" && a.score !== null)
          .map((a) => a.score!);
        const inProgress = rows.filter((a) => a.status === "in_progress").length;
        return {
          awaitingScore: rows.filter((a) => isFinal(a) && a.score === null).length,
          attempts: rows.length,
          submitted: rows.length - inProgress,
          inProgress,
          flagged: rows.filter((a) => a.proctorEvents.length > 0).length,
          averageScore: scores.length
            ? Math.round((scores.reduce((s, n) => s + n, 0) / scores.length) * 100) / 100
            : null,
          highestScore: scores.length ? Math.max(...scores) : null,
          lowestScore: scores.length ? Math.min(...scores) : null,
        };
      },
      listForUser: async (userId, examIds) =>
        [...attempts.values()]
          .filter((a) => a.userId === userId && examIds.includes(a.examId))
          .map(clone),
      countForExam: async (examId) =>
        [...attempts.values()].filter((a) => a.examId === examId).length,
      async saveAnswer(id, questionId, answer, deadlineAfter) {
        const row = attempts.get(id);
        if (!row || row.status !== "in_progress" || row.deadline <= deadlineAfter) return false;
        row.answers[questionId] = { ...row.answers[questionId], ...clone(answer) } as never;
        return true;
      },
      async setJudge(id, questionId, judge) {
        const answer = attempts.get(id)?.answers[questionId];
        if (!answer?.judge || answer.judge.submissionId !== judge.submissionId) return false;
        answer.judge = clone(judge);
        return true;
      },
      async pushEvent(id, event, max) {
        const row = attempts.get(id);
        if (!row || row.status !== "in_progress") return;
        row.proctorEvents = [...row.proctorEvents, clone(event)].slice(-max);
      },
      async finalize(id, patch) {
        const row = attempts.get(id);
        if (!row || row.status !== "in_progress") return false;
        Object.assign(row, clone(patch));
        return true;
      },
      async setScores(id, scores, score) {
        const row = attempts.get(id);
        if (row) Object.assign(row, { scores: clone(scores), score });
      },
      listExpiredInProgress: async (now) =>
        [...attempts.values()]
          .filter((a) => a.status === "in_progress" && a.deadline < now)
          .map(clone),
      async setGrade(id, questionId, grade) {
        const row = attempts.get(id);
        if (!row || !isFinal(row)) return null;
        row.grades = { ...(row.grades ?? {}) };
        if (grade) row.grades[questionId] = clone(grade);
        else delete row.grades[questionId];
        return clone(row);
      },
      async setDeadline(id, deadline) {
        const row = attempts.get(id);
        if (row && row.status === "in_progress") row.deadline = new Date(deadline);
      },
      async rankCounts(examId, score) {
        const scored = [...attempts.values()].filter((a) => a.examId === examId && isFinal(a) && a.score !== null);
        return {
          above: scored.filter((a) => a.score! > score).length,
          below: scored.filter((a) => a.score! < score).length,
          total: scored.length,
        };
      },
      async gradingCounts(examId, questionIds) {
        const rows = [...attempts.values()].filter((a) => a.examId === examId && isFinal(a));
        return Object.fromEntries(
          questionIds.map((q) => {
            const withAnswer = rows.filter((a) => answered(a, q));
            return [q, { answered: withAnswer.length, graded: withAnswer.filter((a) => a.grades?.[q]).length }];
          }),
        );
      },
      async pageForGrading(examId, questionId, { ungradedOnly, limit, cursor }) {
        const start = offsetCursor(cursor);
        const rows = [...attempts.values()].filter(
          (a) => a.examId === examId && isFinal(a) && answered(a, questionId) && (!ungradedOnly || !a.grades?.[questionId]),
        );
        return {
          items: rows.slice(start, start + limit).map(clone),
          nextCursor: rows.length > start + limit ? encodeCursor(start + limit) : null,
        };
      },
    },
    reevaluations: {
      async create(data) {
        if ([...reevaluations.values()].some((r) => r.attemptId === data.attemptId && r.questionId === data.questionId)) {
          throw Object.assign(new Error("duplicate key"), { code: 11000 });
        }
        const row = { ...clone(data), id: randomUUID(), createdAt: new Date() };
        reevaluations.set(row.id, row);
        return clone(row);
      },
      findById: async (id) => (reevaluations.has(id) ? clone(reevaluations.get(id)!) : null),
      listForExam: async (examId, status) =>
        [...reevaluations.values()]
          .filter((r) => r.examId === examId && (!status || r.status === status))
          .slice(0, 500)
          .map(clone),
      listForAttempt: async (attemptId) =>
        [...reevaluations.values()].filter((r) => r.attemptId === attemptId).map(clone),
      countOpen: async (examId) =>
        [...reevaluations.values()].filter((r) => r.examId === examId && r.status === "open").length,
      async resolve(id, patch) {
        const row = reevaluations.get(id);
        if (!row || row.status !== "open") return false;
        Object.assign(row, clone(patch), { status: "resolved" });
        return true;
      },
    },
    bank: {
      async create(data) {
        const now = new Date();
        const row = { ...clone(data), id: randomUUID(), createdAt: now, updatedAt: now };
        bank.set(row.id, row);
        return clone(row);
      },
      findById: async (id) => (bank.has(id) ? clone(bank.get(id)!) : null),
      async update(id, patch) {
        const row = bank.get(id);
        if (!row) return null;
        Object.assign(row, clone(patch), { updatedAt: new Date() });
        return clone(row);
      },
      async delete(id) {
        bank.delete(id);
      },
      async page(institutionId, { q, tag, type, difficulty, limit, cursor }) {
        const start = offsetCursor(cursor);
        const needle = q?.toLowerCase();
        const rows = [...bank.values()]
          .filter(
            (r) =>
              r.institutionId === institutionId &&
              (!needle || r.question.prompt.toLowerCase().includes(needle) || r.topic.toLowerCase().includes(needle)) &&
              (!tag || r.tags.includes(tag)) &&
              (!type || r.question.type === type) &&
              (!difficulty || r.difficulty === difficulty),
          )
          .reverse();
        return {
          items: rows.slice(start, start + limit).map(clone),
          nextCursor: rows.length > start + limit ? encodeCursor(start + limit) : null,
        };
      },
    },
    audit: {
      async record(event) {
        auditLog.push({ ...clone(event), id: randomUUID(), at: new Date().toISOString() });
      },
      async pageForInstitution(institutionId, { limit, cursor }) {
        const start = offsetCursor(cursor);
        const rows = auditLog.filter((e) => e.institutionId === institutionId).reverse();
        return {
          items: rows.slice(start, start + limit).map(clone),
          nextCursor: rows.length > start + limit ? encodeCursor(start + limit) : null,
        };
      },
    },
  };
}
