import { IDENTITY_API_URL } from "@/app/coding-platform/lib/config";
import { authFetch, readEnvelope } from "@/app/lib/auth/session";

const call = (path, { method = "GET", body } = {}) =>
  authFetch(`${IDENTITY_API_URL}${path}`, {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  }).then(readEnvelope);

export const identityApi = {
  me: () => call("/auth/me"),

  createInstitution: (input) => call("/institutions", { method: "POST", body: input }),
  getInstitution: (id) => call(`/institutions/${id}`),

  listMembers: (id) => call(`/institutions/${id}/members`),
  updateMember: (id, userId, patch) =>
    call(`/institutions/${id}/members/${userId}`, { method: "PATCH", body: patch }),
  removeMember: (id, userId) =>
    call(`/institutions/${id}/members/${userId}`, { method: "DELETE" }),

  listBatches: (id) => call(`/institutions/${id}/batches`),
  createBatch: (id, input) =>
    call(`/institutions/${id}/batches`, { method: "POST", body: input }),

  listInvites: (id) => call(`/institutions/${id}/invites`),
  createInvite: (id, input) =>
    call(`/institutions/${id}/invites`, { method: "POST", body: input }),
  revokeInvite: (id, inviteId) =>
    call(`/institutions/${id}/invites/${inviteId}`, { method: "DELETE" }),

  previewInvite: (code) =>
    fetch(`${IDENTITY_API_URL}/invites/${encodeURIComponent(code)}`).then(readEnvelope),
  acceptInvite: (code) =>
    call(`/invites/${encodeURIComponent(code)}/accept`, { method: "POST" }),
};
