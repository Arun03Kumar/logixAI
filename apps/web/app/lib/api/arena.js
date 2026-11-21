import { ARENA_API_URL } from "@/app/coding-platform/lib/config";
import { authFetch, readEnvelope } from "@/app/lib/auth/session";
import { pageQuery } from "./pageQuery";

// authFetch adds the access token when signed in; browsing also works signed out.
const call = (path, { method = "GET", body } = {}) =>
  authFetch(`${ARENA_API_URL}/arena${path}`, {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  }).then(readEnvelope);

const areaQ = (area) => (area ? `?area=${encodeURIComponent(area)}` : "");

export const arenaApi = {
  /** area: "ml" | "frontend" | "system-design" (all when omitted) */
  tracks: (area) => call(`/tracks${areaQ(area)}`),
  courses: (area) => call(`/courses${areaQ(area)}`),
  course: (id) => call(`/courses/${encodeURIComponent(id)}`),
  track: (id) => call(`/tracks/${encodeURIComponent(id)}`),
  topic: (id) => call(`/topics/${encodeURIComponent(id)}`),
  item: (id) => call(`/items/${encodeURIComponent(id)}`),
  /** Every matching problem. filters: q, type, difficulty, status, track, tag, list, access */
  problems: (filters = {}) => call(`/problems?${pageQuery(filters)}`),
  /** Curated lists ("SQL interview set", ...), with the learner's progress. */
  lists: (area) => call(`/lists${areaQ(area)}`),

  /** { selectedOptionIds } | { value } | { text } */
  answer: (id, answer) => call(`/items/${encodeURIComponent(id)}/answer`, { method: "POST", body: answer }),
  reveal: (id) => call(`/items/${encodeURIComponent(id)}/reveal`, { method: "POST" }),
  /** mode: "run" (sample tests) | "submit" (all tests) */
  runCode: (id, code, mode) =>
    call(`/items/${encodeURIComponent(id)}/code`, { method: "POST", body: { code, mode } }),
  submission: (id) => call(`/submissions/${encodeURIComponent(id)}`),
  submissions: ({ cursor, limit = 20, itemId } = {}) => call(`/submissions?${pageQuery({ cursor, limit, itemId })}`),
  dashboard: (area) => call(`/me/dashboard${areaQ(area)}`),
  reviewQueue: (area) => call(`/me/review${areaQ(area)}`),
  skillMap: (area) => call(`/skill-map${areaQ(area)}`),
  myAssignments: () => call("/me/assignments"),

  // Mock interviews and contests (timed sessions)
  mocks: () => call("/mocks"),
  startMock: (templateId) => call("/mocks", { method: "POST", body: { templateId } }),
  session: (id) => call(`/sessions/${encodeURIComponent(id)}`),
  finishSession: (id) => call(`/sessions/${encodeURIComponent(id)}/finish`, { method: "POST" }),
  contests: () => call("/contests"),
  contest: (id) => call(`/contests/${encodeURIComponent(id)}`),
  joinContest: (id) => call(`/contests/${encodeURIComponent(id)}/join`, { method: "POST" }),

  // Public profiles
  myProfile: () => call("/me/profile"),
  saveProfile: (input) => call("/me/profile", { method: "POST", body: input }),
  profile: (handle) => call(`/profiles/${encodeURIComponent(handle)}`),

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
