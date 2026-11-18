import { EXAM_API_URL } from "@/app/coding-platform/lib/config";
import { authFetch, readEnvelope } from "@/app/lib/auth/session";

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
  results: (examId) => call(`/exams/${examId}/results`),
  review: (examId, attemptId) => call(`/exams/${examId}/attempts/${attemptId}`),

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
};
