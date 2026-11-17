// Until real accounts exist (Phase 3), each browser gets its own anonymous id
// so judge results are routed back to the browser that submitted them.

const STORAGE_KEY = "logixai:anonymousUserId";
let cachedId = null;

function randomId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // crypto.randomUUID needs a secure context (https or localhost).
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/** Returns this browser's stable anonymous user id. Client-side only. */
export function getClientUserId() {
  if (cachedId) return cachedId;
  try {
    cachedId = localStorage.getItem(STORAGE_KEY);
  } catch {
    // storage blocked: fall through and use an in-memory id for this tab
  }
  if (!cachedId) {
    cachedId = `anon-${randomId()}`;
    try {
      localStorage.setItem(STORAGE_KEY, cachedId);
    } catch {
      // ignore
    }
  }
  return cachedId;
}
