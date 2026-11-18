import { randomUUID } from "node:crypto";
import type { AuditEvent } from "@logixai/contracts";
import { decodeCursor, encodeCursor } from "@logixai/service-kit";
import type { AttemptRecord, ExamRecord, Store } from "./types.js";

const offsetCursor = (cursor: string | undefined) =>
  decodeCursor(cursor, (v): v is number => Number.isInteger(v) && (v as number) >= 0) ?? 0;

const clone = <T>(value: T): T => structuredClone(value);

/** In-memory Store for tests. Mirrors MongoStore's conditional updates. */
export function createMemoryStore(): Store {
  const exams = new Map<string, ExamRecord>();
  const attempts = new Map<string, AttemptRecord>();
  const auditLog: AuditEvent[] = [];

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
