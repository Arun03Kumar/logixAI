// Public runtime config: the API URLs the browser talks to.
//
// Read in this order, so one built image can be deployed to any domain:
//   1. runtime: PUBLIC_* environment variables of the web server, sent to the
//      browser by /runtime-config.js (loaded in the root layout before the app);
//   2. build time: NEXT_PUBLIC_* values inlined by `next build` (apps/web/.env.local);
//   3. local development defaults.
// Each process.env.NEXT_PUBLIC_* access must stay literal so Next.js can inline it.

/** The variables /runtime-config.js may expose (all public URLs, never secrets). */
export const RUNTIME_KEYS = [
  "PROBLEM_API_URL",
  "SUBMISSION_API_URL",
  "IDENTITY_API_URL",
  "EXAM_API_URL",
  "SOCKET_URL",
  "ARENA_API_URL",
  "BILLING_API_URL",
];

const runtime =
  typeof window !== "undefined"
    ? (window.__LOGIXAI_ENV ?? {})
    : Object.fromEntries(RUNTIME_KEYS.map((k) => [k, process.env[`PUBLIC_${k}`]]));

const pick = (key, inlined, fallback) => runtime[key] || inlined || fallback;

export const PROBLEM_API_URL = pick(
  "PROBLEM_API_URL",
  process.env.NEXT_PUBLIC_PROBLEM_API_URL,
  "http://localhost:3001/api/v1",
);

export const SUBMISSION_API_URL = pick(
  "SUBMISSION_API_URL",
  process.env.NEXT_PUBLIC_SUBMISSION_API_URL,
  "http://localhost:3000/api/v1",
);

export const IDENTITY_API_URL = pick(
  "IDENTITY_API_URL",
  process.env.NEXT_PUBLIC_IDENTITY_API_URL,
  "http://localhost:3006/api/v1",
);

export const EXAM_API_URL = pick("EXAM_API_URL", process.env.NEXT_PUBLIC_EXAM_API_URL, "http://localhost:3007/api/v1");

export const SOCKET_URL = pick("SOCKET_URL", process.env.NEXT_PUBLIC_SOCKET_URL, "http://localhost:3005");

export const ARENA_API_URL = pick(
  "ARENA_API_URL",
  process.env.NEXT_PUBLIC_ARENA_API_URL,
  "http://localhost:3010/api/v1",
);

export const BILLING_API_URL = pick(
  "BILLING_API_URL",
  process.env.NEXT_PUBLIC_BILLING_API_URL,
  "http://localhost:3011/api/v1",
);
