// Signed-in learners using the judge: dashboard, an item that runs on the
// server (PyTorch, JavaScript, ...), then Run (80%) or Submit (20%) and wait for
// the verdict. Measures the judge round trip under load.
//
// Creates one test account per virtual user, so run it against STAGING only,
// with these raised there (see load/README.md):
//   identity: AUTH_RATE_LIMIT_PER_MINUTE=100000   ACCESS_TOKEN_TTL_SECONDS=7200
//   arena:    FREE_DAILY_CODE_RUNS=100000         CODE_RUNS_PER_MINUTE=60
//
//   k6 run -e BASE_URL=https://staging.example.com -e PROFILE=2k load/practice.js
import http from "k6/http";
import { check, sleep } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";
import { API, API_P95_MS, JUDGE_P95_MS, MAX_ERROR_RATE, PROFILE, pick, stagesFor, think } from "./lib/config.js";

/** Accounts to create: one per virtual user at the peak. */
const USERS = Number(__ENV.USERS || (__ENV.VUS ? __ENV.VUS : { smoke: 5, "2k": 2000, "50k": 50000 }[PROFILE] ?? 5));
const RUN_ID = __ENV.RUN_ID || `${Date.now()}`;
const PASSWORD = __ENV.LOAD_PASSWORD || "load-test-password-1";

const judgeRoundTrip = new Trend("judge_round_trip", true);
const busy = new Counter("judge_busy_refusals");
const judged = new Rate("judge_result_received");

// A "busy" 429 and a 409 (previous run still judging) are designed answers, not failures.
http.setResponseCallback(http.expectedStatuses(200, 201, 202, 409, 429));

export const options = {
  setupTimeout: "30m",
  scenarios: { practice: stagesFor() },
  thresholds: {
    http_req_failed: [`rate<${MAX_ERROR_RATE}`],
    "http_req_duration{kind:api}": [`p(95)<${API_P95_MS}`],
    judge_round_trip: [`p(95)<${JUDGE_P95_MS}`],
    judge_result_received: ["rate>0.99"],
  },
};

const json = (body) => ({ body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
const auth = (token, name, kind = "api") => ({ headers: { Authorization: `Bearer ${token}` }, tags: { name, kind } });

function login(email) {
  const res = http.post(`${API.identity}/auth/login`, JSON.stringify({ email, password: PASSWORD }), {
    headers: { "Content-Type": "application/json" },
    tags: { name: "login", kind: "auth" },
  });
  return res.status === 200 ? res.json("data.accessToken") : null;
}

/** Creates the test accounts (in batches) and finds free items that run on the judge. */
export function setup() {
  const users = [];
  for (let start = 0; start < USERS; start += 50) {
    const batch = [];
    for (let i = start; i < Math.min(USERS, start + 50); i++) {
      const email = `load-${RUN_ID}-${i}@example.test`;
      batch.push(["POST", `${API.identity}/auth/signup`, JSON.stringify({ name: `Load ${i}`, email, password: PASSWORD }), { headers: { "Content-Type": "application/json" }, tags: { name: "signup", kind: "auth" } }]);
      users.push({ email });
    }
    http.batch(batch).forEach((res, j) => {
      const u = users[start + j];
      u.token = res.status === 201 ? res.json("data.accessToken") : login(u.email);
    });
  }
  if (!users.every((u) => u.token)) throw new Error("couldn't create the test accounts: is AUTH_RATE_LIMIT_PER_MINUTE raised on this environment?");

  const items = [];
  const tracks = http.get(`${API.arena}/tracks`).json("data");
  for (const t of tracks) {
    for (const topic of http.get(`${API.arena}/tracks/${t.id}`).json("data.topics")) {
      for (const it of http.get(`${API.arena}/topics/${topic.id}`).json("data.items") ?? []) {
        if (it.access !== "free" || !["code", "debug", "sql"].includes(it.type)) continue;
        const view = http.get(`${API.arena}/items/${it.id}`).json("data");
        if (view.runIn === "server" && view.starterCode) items.push({ id: it.id, code: view.starterCode });
      }
    }
    if (items.length >= 40) break;
  }
  if (!items.length) throw new Error("no free server-run items found");
  return { users, items };
}

export default function (data) {
  const user = data.users[(__VU - 1) % data.users.length];
  let token = user.token;

  let res = http.get(`${API.arena}/me/dashboard?area=ml`, auth(token, "dashboard"));
  if (res.status === 401) {
    token = login(user.email) || token; // access token expired: sign in again
    user.token = token;
    res = http.get(`${API.arena}/me/dashboard?area=ml`, auth(token, "dashboard"));
  }
  check(res, { "dashboard 200": (r) => r.status === 200 });
  sleep(think());

  const item = pick(data.items);
  check(http.get(`${API.arena}/items/${item.id}`, auth(token, "item")), { "item 200": (r) => r.status === 200 });
  sleep(think(10, 30)); // writing code

  const mode = Math.random() < 0.2 ? "submit" : "run";
  const started = Date.now();
  const sent = http.post(`${API.arena}/items/${item.id}/code`, JSON.stringify({ code: item.code, mode }), {
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    tags: { name: `code-${mode}`, kind: "api" },
  });
  if (sent.status === 429) {
    busy.add(1);
    sleep(think(20, 40));
    return;
  }
  if (sent.status !== 202) {
    sleep(think());
    return;
  }

  // Wait for the verdict (the page uses the result stream; k6 polls the same data).
  const id = sent.json("data.id");
  let done = false;
  for (let i = 0; i < 120 && !done; i++) {
    sleep(1);
    const s = http.get(`${API.arena}/submissions/${id}`, auth(token, "submission", "poll"));
    done = s.status === 200 && s.json("data.status") !== "pending";
  }
  judged.add(done);
  if (done) judgeRoundTrip.add(Date.now() - started, { mode });
  sleep(think(5, 15));
}
