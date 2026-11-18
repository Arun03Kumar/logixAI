// Public runtime config for the coding platform.
// NEXT_PUBLIC_* values are inlined at build time; set them in apps/web/.env.local.
// Each process.env access must stay literal so Next.js can inline it.

export const PROBLEM_API_URL =
  process.env.NEXT_PUBLIC_PROBLEM_API_URL || "http://localhost:3001/api/v1";

export const SUBMISSION_API_URL =
  process.env.NEXT_PUBLIC_SUBMISSION_API_URL || "http://localhost:3000/api/v1";

export const IDENTITY_API_URL =
  process.env.NEXT_PUBLIC_IDENTITY_API_URL || "http://localhost:3006/api/v1";

export const EXAM_API_URL =
  process.env.NEXT_PUBLIC_EXAM_API_URL || "http://localhost:3007/api/v1";

export const SOCKET_URL =
  process.env.NEXT_PUBLIC_SOCKET_URL || "http://localhost:3005";

export const ARENA_API_URL =
  process.env.NEXT_PUBLIC_ARENA_API_URL || "http://localhost:3010/api/v1";
