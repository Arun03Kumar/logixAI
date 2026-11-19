import { EXAM_API_URL } from "@/app/coding-platform/lib/config";
import { authFetch, readEnvelope } from "@/app/lib/auth/session";
import { pageQuery } from "./pageQuery";

const call = (path, { method = "GET", body } = {}) =>
  authFetch(`${EXAM_API_URL}${path}`, {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  }).then(readEnvelope);

export const examApi = {
  // Authoring (instructors / admins)
  list: (institutionId) => call(`/institutions/${institutionId}/exams`),
  create: (institutionId, title) =>
    call(`/institutions/${institutionId}/exams`, { method: "POST", body: { title } }),
  get: (examId) => call(`/exams/${examId}`),
  save: (examId, draft) => call(`/exams/${examId}`, { method: "PUT", body: draft }),
  remove: (examId) => call(`/exams/${examId}`, { method: "DELETE" }),
  publish: (examId) => call(`/exams/${examId}/publish`, { method: "POST" }),
  unpublish: (examId) => call(`/exams/${examId}/unpublish`, { method: "POST" }),
  /** One page of results (best first) with the whole-exam summary. */
  results: (examId, { cursor, limit = 50 } = {}) =>
    call(`/exams/${examId}/results?${pageQuery({ cursor, limit })}`),
  /** Every result as a CSV file, built by the server. */
  exportResults: async (examId) => {
    const res = await authFetch(`${EXAM_API_URL}/exams/${examId}/results/export`);
    if (!res.ok) await readEnvelope(res); // throws the server's message
    const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1];
    return { blob: await res.blob(), filename: name ?? "exam-results.csv" };
  },
  review: (examId, attemptId) => call(`/exams/${examId}/attempts/${attemptId}`),

  // Grading (graders: instructors, department heads, assistants)
  gradingOverview: (examId) => call(`/exams/${examId}/grading`),
  /** show: "ungraded" | "all" */
  gradingQueue: (examId, questionId, { show = "ungraded", cursor, limit = 20 } = {}) =>
    call(`/exams/${examId}/grading/${questionId}?${pageQuery({ show, cursor, limit })}`),
  /** marks null = back to the automatic score. */
  grade: (examId, attemptId, questionId, body) =>
    call(`/exams/${examId}/attempts/${attemptId}/grades/${questionId}`, { method: "PUT", body }),
  setExtraTime: (examId, userId, minutes) =>
    call(`/exams/${examId}/extra-time`, { method: "PUT", body: { userId, minutes } }),
  reevaluations: (examId, status) => call(`/exams/${examId}/reevaluations${status ? `?status=${status}` : ""}`),
  resolveReevaluation: (examId, requestId, body) =>
    call(`/exams/${examId}/reevaluations/${requestId}/resolve`, { method: "POST", body }),

  // Question bank (staff who set exams)
  /** filters: q, tag, type, difficulty, cursor, limit */
  bank: (institutionId, filters = {}) =>
    call(`/institutions/${institutionId}/question-bank?${pageQuery({ limit: 20, ...filters })}`),
  addToBank: (institutionId, body) => call(`/institutions/${institutionId}/question-bank`, { method: "POST", body }),
  updateBankQuestion: (institutionId, id, body) =>
    call(`/institutions/${institutionId}/question-bank/${id}`, { method: "PUT", body }),
  removeBankQuestion: (institutionId, id) =>
    call(`/institutions/${institutionId}/question-bank/${id}`, { method: "DELETE" }),

  // Taking (students)
  start: (examId) => call(`/exams/${examId}/attempts`, { method: "POST" }),
  attempt: (attemptId) => call(`/attempts/${attemptId}`),
  saveAnswer: (attemptId, questionId, answer) =>
    call(`/attempts/${attemptId}/answers/${questionId}`, { method: "PUT", body: answer }),
  run: (attemptId, questionId) =>
    call(`/attempts/${attemptId}/answers/${questionId}/run`, { method: "POST" }),
  event: (attemptId, type) =>
    call(`/attempts/${attemptId}/events`, { method: "POST", body: { type } }),
  submit: (attemptId) => call(`/attempts/${attemptId}/submit`, { method: "POST" }),
  myResult: (examId) => call(`/exams/${examId}/my-result`),
  requestReevaluation: (examId, questionId, reason) =>
    call(`/exams/${examId}/my-result/reevaluations`, { method: "POST", body: { questionId, reason } }),
};
