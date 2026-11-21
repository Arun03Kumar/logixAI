import { RUNTIME_KEYS } from "@/app/coding-platform/lib/config";

// Read the environment on every request, not at build time.
export const dynamic = "force-dynamic";

/**
 * GET /runtime-config.js: the PUBLIC_* URLs from the server's environment, for
 * the browser (see coding-platform/lib/config.js). Only whitelisted keys are
 * sent, and only those that are set.
 */
export function GET() {
  const env = {};
  for (const key of RUNTIME_KEYS) {
    const value = process.env[`PUBLIC_${key}`];
    if (value) env[key] = value;
  }
  return new Response(`window.__LOGIXAI_ENV=${JSON.stringify(env).replace(/</g, "\\u003c")};`, {
    headers: {
      "content-type": "application/javascript; charset=utf-8",
      "cache-control": "public, max-age=60",
    },
  });
}
