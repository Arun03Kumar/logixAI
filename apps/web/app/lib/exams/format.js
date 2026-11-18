// Shared labels and formatting for exam screens.

export const PHASE = {
  draft: { label: "Draft", tone: "neutral" },
  upcoming: { label: "Scheduled", tone: "info" },
  live: { label: "Live", tone: "success" },
  ended: { label: "Closed", tone: "neutral" },
};

export const ATTEMPT_STATUS = {
  in_progress: { label: "In progress", tone: "warning" },
  submitted: { label: "Submitted", tone: "success" },
  auto_submitted: { label: "Auto-submitted", tone: "neutral" },
};

export const QUESTION_TYPE = {
  mcq_single: "Single choice",
  mcq_multi: "Multiple choice",
  coding: "Coding",
};

export const PROCTOR_EVENT = {
  tab_hidden: "Switched tab or window",
  window_blur: "Left the exam window",
  fullscreen_exit: "Exited fullscreen",
  copy: "Tried to copy",
  paste: "Tried to paste",
};

const dateTime = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
});
export const formatDateTime = (iso) => (iso ? dateTime.format(new Date(iso)) : "—");

export function formatWindow(startsAt, endsAt) {
  if (!startsAt || !endsAt) return "Not scheduled";
  return `${formatDateTime(startsAt)} – ${formatDateTime(endsAt)}`;
}

export const formatScore = (score, max) =>
  score === null || score === undefined ? "—" : `${score} / ${max}`;

/** "1h 05m 09s" style countdown. */
export function formatCountdown(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** ISO -> value for <input type="datetime-local"> in the browser's timezone. */
export function toLocalInput(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export const fromLocalInput = (value) => (value ? new Date(value).toISOString() : null);

/** Short id matching the contracts' id rule ([A-Za-z0-9_-]). */
export const newId = () => crypto.randomUUID().replace(/-/g, "").slice(0, 12);
