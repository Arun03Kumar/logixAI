// Shared settings for the k6 load tests (see load/README.md).
//
// Through the router (staging / production layout):
//   BASE_URL=https://staging.example.com
// Directly at local services (no router):
//   ARENA_API=http://localhost:3010/api/v1  IDENTITY_API=http://localhost:3006/api/v1

const BASE = (__ENV.BASE_URL || "http://localhost:8080").replace(/\/$/, "");

/** API bases, matching the web app's PUBLIC_*_API_URL values. */
export const API = {
  arena: `${(__ENV.ARENA_API || `${BASE}/api/arena/v1`).replace(/\/$/, "")}/arena`,
  identity: (__ENV.IDENTITY_API || `${BASE}/api/identity/v1`).replace(/\/$/, ""),
};

/**
 * Load profiles. `2k` and `50k` are the targets in docs/production-plan.md;
 * 50k needs several load generators (k6 distributed / k6 Cloud), not one machine.
 * VUS + DURATION override with a constant load.
 */
const PROFILES = {
  smoke: { stages: [{ duration: "30s", target: 5 }] },
  "2k": {
    stages: [
      { duration: "3m", target: 2000 },
      { duration: "10m", target: 2000 },
      { duration: "2m", target: 0 },
    ],
  },
  "50k": {
    stages: [
      { duration: "10m", target: 50000 },
      { duration: "10m", target: 50000 },
      { duration: "5m", target: 0 },
    ],
  },
};

export const PROFILE = __ENV.PROFILE || "smoke";

/** k6 scenario options for the chosen profile (scaled by `share` of the virtual users). */
export function stagesFor(share = 1) {
  if (__ENV.VUS) {
    return { executor: "constant-vus", vus: Math.max(1, Math.round(Number(__ENV.VUS) * share)), duration: __ENV.DURATION || "1m" };
  }
  const p = PROFILES[PROFILE];
  if (!p) throw new Error(`unknown PROFILE ${PROFILE} (use ${Object.keys(PROFILES).join(", ")})`);
  return {
    executor: "ramping-vus",
    startVUs: 0,
    stages: p.stages.map((s) => ({ ...s, target: Math.round(s.target * share) })),
    gracefulRampDown: "30s",
  };
}

/** Targets from the production plan: page/API p95 and error rates. */
export const API_P95_MS = PROFILE === "50k" ? 500 : 300;
export const MAX_ERROR_RATE = PROFILE === "50k" ? 0.005 : 0.001;
export const JUDGE_P95_MS = PROFILE === "50k" ? 6000 : 3000;

/** Think time between a learner's actions. */
export const think = (min = 2, max = 6) => min + Math.random() * (max - min);

export const pick = (list) => list[Math.floor(Math.random() * list.length)];
