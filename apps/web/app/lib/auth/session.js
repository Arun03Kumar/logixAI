/*
 * Browser session.
 *
 * - The refresh token lives in an httpOnly cookie set by identity-service;
 *   JavaScript never sees it.
 * - The short-lived access token lives only in memory here and is sent as
 *   `Authorization: Bearer` to the other services.
 * - On page load (and whenever the access token is about to expire) we call
 *   /auth/refresh, which rotates the cookie and returns a new access token.
 *
 * Framework-free so Redux thunks and the socket client can use it too.
 */
import { IDENTITY_API_URL } from "@/app/coding-platform/lib/config";

const EXPIRY_MARGIN_MS = 30_000;

/**
 * @typedef {{ id: string, name: string, email: string, role: "user" | "admin", createdAt: string }} SessionUser
 * @typedef {{ status: "loading" | "authenticated" | "anonymous", user: SessionUser | null }} SessionState
 */

/** @type {SessionState} */
let state = { status: "loading", user: null };
let accessToken = null;
let expiresAt = 0;
let refreshing = null;
const listeners = new Set();

function setState(next) {
  state = next;
  listeners.forEach((listener) => listener());
}

function applySession(session) {
  accessToken = session.accessToken;
  expiresAt = Date.now() + session.expiresIn * 1000;
  setState({ status: "authenticated", user: session.user });
}

function clearSession() {
  accessToken = null;
  expiresAt = 0;
  setState({ status: "anonymous", user: null });
}

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** @returns {SessionState} */
export const getSnapshot = () => state;
/** @type {SessionState} */
const SERVER_SNAPSHOT = { status: "loading", user: null };
/** @returns {SessionState} */
export const getServerSnapshot = () => SERVER_SNAPSHOT;

/** Error from an API call, with per-field messages for forms. */
export class ApiError extends Error {
  constructor(message, status, fieldErrors = {}, details = null) {
    super(message);
    this.status = status;
    this.fieldErrors = fieldErrors;
    /** The response's `error` object, e.g. { reason, problems } */
    this.details = details;
  }
}

/** Turns the service envelope into data or an ApiError. */
export async function readEnvelope(res) {
  const body = await res.json().catch(() => null);
  if (res.ok && body?.success !== false) return body?.data;

  const issues = Array.isArray(body?.error) ? body.error : [];
  const fieldErrors = {};
  for (const issue of issues) {
    const field = issue?.path?.[0];
    if (field && !fieldErrors[field]) fieldErrors[field] = issue.message;
  }
  const message =
    body?.error?.reason ||
    (issues.length ? "Check the highlighted fields." : null) ||
    body?.message ||
    "Something went wrong. Try again.";
  throw new ApiError(message, res.status, fieldErrors, body?.error ?? null);
}

/** Exchanges the refresh cookie for a new access token. Concurrent calls share one request. */
export function refreshSession() {
  refreshing ??= fetch(`${IDENTITY_API_URL}/auth/refresh`, {
    method: "POST",
    credentials: "include",
  })
    .then(async (res) => {
      if (!res.ok) {
        clearSession();
        return null;
      }
      const session = await readEnvelope(res);
      applySession(session);
      return session;
    })
    .catch(() => {
      clearSession();
      return null;
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

/** A valid access token, refreshing first if needed; null when signed out. */
export async function getAccessToken() {
  if (accessToken && Date.now() < expiresAt - EXPIRY_MARGIN_MS) return accessToken;
  const session = await refreshSession();
  return session?.accessToken ?? null;
}

async function authRequest(path, body) {
  const res = await fetch(`${IDENTITY_API_URL}${path}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const session = await readEnvelope(res);
  applySession(session);
  return session.user;
}

export const signIn = (email, password) => authRequest("/auth/login", { email, password });
export const signUp = (name, email, password) =>
  authRequest("/auth/signup", { name, email, password });

export async function signOut() {
  await fetch(`${IDENTITY_API_URL}/auth/logout`, {
    method: "POST",
    credentials: "include",
  }).catch(() => {});
  clearSession();
}

/**
 * fetch() with the access token attached. Retries once after a refresh when
 * the token was rejected (e.g. the identity service restarted).
 */
export async function authFetch(url, init = {}) {
  const send = (token) =>
    fetch(url, {
      ...init,
      headers: {
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });

  let res = await send(await getAccessToken());
  if (res.status === 401 && state.status === "authenticated") {
    accessToken = null;
    res = await send(await getAccessToken());
  }
  return res;
}
