import { ARENA_API_URL } from "@/app/coding-platform/lib/config";
import { authFetch, readEnvelope } from "@/app/lib/auth/session";
import { pageQuery } from "./pageQuery";

// authFetch adds the access token when signed in; browsing also works signed out.
const call = (path, { method = "GET", body } = {}) =>
  authFetch(`${ARENA_API_URL}/arena${path}`, {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  }).then(readEnvelope);

export const arenaApi = {
  tracks: () => call("/tracks"),
  track: (id) => call(`/tracks/${encodeURIComponent(id)}`),
  topic: (id) => call(`/topics/${encodeURIComponent(id)}`),
  item: (id) => call(`/items/${encodeURIComponent(id)}`),

  /** { selectedOptionIds } | { value } | { text } */
  answer: (id, answer) => call(`/items/${encodeURIComponent(id)}/answer`, { method: "POST", body: answer }),
  reveal: (id) => call(`/items/${encodeURIComponent(id)}/reveal`, { method: "POST" }),
  /** mode: "run" (sample tests) | "submit" (all tests) */
  runCode: (id, code, mode) =>
    call(`/items/${encodeURIComponent(id)}/code`, { method: "POST", body: { code, mode } }),
  submission: (id) => call(`/submissions/${encodeURIComponent(id)}`),
  submissions: ({ cursor, limit = 20, itemId } = {}) => call(`/submissions?${pageQuery({ cursor, limit, itemId })}`),
  dashboard: () => call("/me/dashboard"),
  reviewQueue: () => call("/me/review"),
  skillMap: () => call("/skill-map"),
  myAssignments: () => call("/me/assignments"),

  // Institutions (instructors and admins manage; students see their batches)
  assignments: (institutionId) => call(`/institutions/${encodeURIComponent(institutionId)}/assignments`),
  assignTrack: (institutionId, input) =>
    call(`/institutions/${encodeURIComponent(institutionId)}/assignments`, { method: "POST", body: input }),
  unassignTrack: (institutionId, assignmentId) =>
    call(`/institutions/${encodeURIComponent(institutionId)}/assignments/${encodeURIComponent(assignmentId)}`, {
      method: "DELETE",
    }),
  batchReport: (institutionId, batchId, trackId) =>
    call(
      `/institutions/${encodeURIComponent(institutionId)}/report?${new URLSearchParams({ batchId, trackId })}`,
    ),
};
