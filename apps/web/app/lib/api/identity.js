import { IDENTITY_API_URL } from "@/app/coding-platform/lib/config";
import { authFetch, readEnvelope } from "@/app/lib/auth/session";
import { pageQuery } from "./pageQuery";

const call = (path, { method = "GET", body } = {}) =>
  authFetch(`${IDENTITY_API_URL}${path}`, {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  }).then(readEnvelope);

export const identityApi = {
  me: () => call("/auth/me"),

  getInstitution: (id) => call(`/institutions/${id}`),

  /** One page of members, owners first: { items, nextCursor }. */
  listMembers: (id, { cursor, limit = 50, role } = {}) =>
    call(`/institutions/${id}/members?${pageQuery({ cursor, limit, role })}`),
  /** Admins only: institution changes, newest first. */
  listAudit: (id, { cursor, limit = 50 } = {}) =>
    call(`/institutions/${id}/audit?${pageQuery({ cursor, limit })}`),
  updateMember: (id, userId, patch) =>
    call(`/institutions/${id}/members/${userId}`, { method: "PATCH", body: patch }),
  removeMember: (id, userId) =>
    call(`/institutions/${id}/members/${userId}`, { method: "DELETE" }),
  /** Accounts the institution created only: { tempPassword } */
  resetPassword: (id, userId) =>
    call(`/institutions/${id}/members/${userId}/password`, { method: "POST" }),
  /** { rows: [{ name, rollNumber, email, batch }], batchId, createBatches, dryRun } */
  importStudents: (id, input) =>
    call(`/institutions/${id}/import`, { method: "POST", body: input }),

  /** status: pending | approved | rejected */
  listJoinRequests: (id, status = "pending") =>
    call(`/institutions/${id}/join-requests?${new URLSearchParams({ status })}`),
  /** { approve, batchId? } */
  decideJoinRequest: (id, requestId, decision) =>
    call(`/institutions/${id}/join-requests/${requestId}/decision`, { method: "POST", body: decision }),
  /** Institutions matching the caller's email domain. */
  suggestedInstitutions: () => call("/institutions/suggested"),
  requestToJoin: (id, body = {}) =>
    call(`/institutions/${id}/join-requests`, { method: "POST", body }),

  listBatches: (id) => call(`/institutions/${id}/batches`),
  createBatch: (id, input) =>
    call(`/institutions/${id}/batches`, { method: "POST", body: input }),
  /** { name?, departmentId?, academicYear?, archived? } */
  updateBatch: (id, batchId, patch) =>
    call(`/institutions/${id}/batches/${batchId}`, { method: "PATCH", body: patch }),
  /** { toBatchId } or { newBatch: { name, academicYear } }, plus archiveSource */
  promoteBatch: (id, batchId, input) =>
    call(`/institutions/${id}/batches/${batchId}/promote`, { method: "POST", body: input }),

  listDepartments: (id) => call(`/institutions/${id}/departments`),
  createDepartment: (id, input) =>
    call(`/institutions/${id}/departments`, { method: "POST", body: input }),
  updateDepartment: (id, departmentId, patch) =>
    call(`/institutions/${id}/departments/${departmentId}`, { method: "PATCH", body: patch }),
  deleteDepartment: (id, departmentId) =>
    call(`/institutions/${id}/departments/${departmentId}`, { method: "DELETE" }),

  listInvites: (id) => call(`/institutions/${id}/invites`),
  createInvite: (id, input) =>
    call(`/institutions/${id}/invites`, { method: "POST", body: input }),
  revokeInvite: (id, inviteId) =>
    call(`/institutions/${id}/invites/${inviteId}`, { method: "DELETE" }),

  previewInvite: (code) =>
    fetch(`${IDENTITY_API_URL}/invites/${encodeURIComponent(code)}`).then(readEnvelope),
  // Platform admins (the institutions console)
  admin: {
    list: (q) => call(`/admin/institutions?${new URLSearchParams(q ? { q } : {})}`),
    /** { name, type, ownerEmails, departments, features?, contract? } */
    create: (input) => call("/admin/institutions", { method: "POST", body: input }),
    get: (id) => call(`/admin/institutions/${id}`),
    /** { name?, type?, status?, emailDomains? } */
    update: (id, patch) => call(`/admin/institutions/${id}`, { method: "PATCH", body: patch }),
    setFeatures: (id, features) => call(`/admin/institutions/${id}/features`, { method: "PUT", body: features }),
    /** contract or null to remove it */
    setContract: (id, contract) =>
      call(`/admin/institutions/${id}/contract`, { method: "PUT", body: contract ?? { contract: null } }),
    addOwner: (id, email) => call(`/admin/institutions/${id}/owners`, { method: "POST", body: { email } }),
  },

  /** The membership, or { pending: true, institution } when staff must approve. */
  acceptInvite: (code, body = {}) =>
    call(`/invites/${encodeURIComponent(code)}/accept`, { method: "POST", body }),
};
