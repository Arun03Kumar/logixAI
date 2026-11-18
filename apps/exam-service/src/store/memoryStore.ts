import { randomUUID } from "node:crypto";
import type { AttemptRecord, ExamRecord, Store } from "./types.js";

const clone = <T>(value: T): T => structuredClone(value);

/** In-memory Store for tests. Mirrors MongoStore's conditional updates. */
export function createMemoryStore(): Store {
  const exams = new Map<string, ExamRecord>();
  const attempts = new Map<string, AttemptRecord>();

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
      listForExam: async (examId) =>
        [...attempts.values()].filter((a) => a.examId === examId).map(clone),
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
  };
}
