# Load tests (k6)

Two scenarios, checked against the targets in
[docs/production-plan.md](../docs/production-plan.md):

| Script | Who | What it does |
| --- | --- | --- |
| `browse.js` | signed-out visitors | catalog pages, an item, its browser-runner kit, the problem list. Read-only. |
| `practice.js` | signed-in learners | dashboard, an item that runs on the judge, then Run (80%) or Submit (20%) and wait for the verdict. Creates one test account per virtual user. |

Profiles (`-e PROFILE=...`):

| Profile | Virtual users | Thresholds (fail the run when missed) |
| --- | --- | --- |
| `smoke` (default) | 5 for 30 s | API p95 < 300 ms, errors < 0.1%, judge round trip p95 < 3 s |
| `2k` | ramp to 2,000, hold 10 min | same |
| `50k` | ramp to 50,000, hold 10 min | API p95 < 500 ms, errors < 0.5%, judge p95 < 6 s |

`-e VUS=200 -e DURATION=2m` runs a constant load instead. A virtual user
thinks between actions like a learner (seconds to tens of seconds), so 2,000
virtual users is roughly 2,000 people using the site at once.

## Running

k6 runs from Docker, so nothing needs installing:

```powershell
docker run --rm -v "${PWD}/load:/load" grafana/k6:0.54.0 run -e BASE_URL=https://staging.example.com -e PROFILE=smoke /load/browse.js
```

Without the router, point at the services directly (from inside Docker the
host is `host.docker.internal`):

```powershell
docker run --rm -v "${PWD}/load:/load" grafana/k6:0.54.0 run -e ARENA_API=http://host.docker.internal:3010/api/v1 -e IDENTITY_API=http://host.docker.internal:3006/api/v1 /load/browse.js
```

**Run `practice.js` against staging only.** It signs up test accounts
(`load-<run>-<n>@example.test`), and the guards that protect production would
stop it, so raise them on staging:

| Service | Setting | Production | For load tests |
| --- | --- | --- | --- |
| identity | `AUTH_RATE_LIMIT_PER_MINUTE` | 10 | 100000 |
| identity | `ACCESS_TOKEN_TTL_SECONDS` | 900 | 7200 (longer than the test) |
| arena | `FREE_DAILY_CODE_RUNS` | 30 | 100000 |
| arena | `CODE_RUNS_PER_MINUTE` | 12 | 60 |

Delete the test accounts afterwards (they all end in `@example.test`).

## 50,000 users

One machine can't generate 50,000 virtual users: run k6 distributed (the k6
Kubernetes operator splits a test across pods) or on Grafana Cloud k6. Watch
the Grafana dashboard ("LogixAI overview") while it runs: the judge backlog,
queue wait and evaluator count show whether autoscaling keeps up, and Run
answers "busy" (counted as `judge_busy_refusals`, not as errors) once the
backlog passes `JUDGE_BUSY_BACKLOG`.

## Reading the results

- `http_req_duration{kind:api}`: API latency (p95 is the target).
- `judge_round_trip`: from sending Run/Submit to having the verdict.
- `judge_result_received`: share of runs that got a verdict within 2 minutes.
- `judge_busy_refusals`: Runs refused with "busy" (by design under overload).

Results from runs so far are in [results.md](results.md).
