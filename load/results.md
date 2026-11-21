# Load test results

## 2026-11-21 — first runs, one laptop

**Setup.** Production images (`NODE_ENV=production`) for all eight services on
one Windows laptop (Docker Desktop), behind the real router (Caddy, same
Caddyfile as production), MongoDB and Redis in containers, one evaluator with
4 judge slots per queue group. k6 ran on the same machine, so it competed with
the services for CPU: treat these numbers as a floor, not a ceiling.

### Browsing (signed out) — `browse.js`, 1,000 virtual users, 2 minutes

| | Result | Target |
| --- | --- | --- |
| Requests | 32,158 (216/s), 0 failed | errors < 0.1% |
| API p95 | **30 ms** (median 1.5 ms) | < 300 ms |
| API p99 | 963 ms | — |

Passed. Every catalog route took under 1 ms in the service. The slow tail is
`/problems`, which returns all 504 problems (172 KB) whatever `limit` asks
for; the router compresses it to 20 KB for browsers (k6 doesn't ask for
compression, so it measured the worst case). **Done** (same day): it now
returns 50 at a time (27 KB uncompressed, ~4 KB gzipped) with totals and tag
counts over every match, and the page has "Show N more".

Found and fixed during this run: the router's rewrite rules applied in the
wrong order (Caddy runs `rewrite` before `uri`), so every `/api/<service>/...`
path returned 404 through the router. Validation hadn't caught it; a real
request did.

### Learners using the judge — `practice.js`, 100 virtual users, 3 minutes

Each learner opens items that run on the server (PyTorch, JavaScript), then
sends Run (80%) or Submit (20%) with the starter code.

| | First run | After the backpressure fix | Target |
| --- | --- | --- | --- |
| API p95 | 528 ms | 581 ms | < 300 ms |
| Runs refused "busy" at once | 0 | 132 | — |
| Python-ML average queue wait | 72 s | 21.5 s | — |
| Judge round trip median / p95 | 9 s / 107 s | 8 s / 59 s | p95 < 3 s |
| Results within 2 minutes | 88.7% | 91.2% | > 99% |

Failed: the Python-ML judge was over capacity for the whole run (4 slots for
about 0.7 jobs/s, at roughly 6 s per job). What it showed:

1. **Backpressure by count didn't work.** "Busy above 500 waiting jobs" never
   triggered while learners waited minutes: 500 PyTorch jobs is a 14-minute
   wait at this speed. Fixed: Run is also refused when the next job in the
   queue has waited more than `JUDGE_BUSY_WAIT_SECONDS` (30 s). The second run
   shows it working; what still waits is Submits, which are always accepted.
2. **Imports dominate Python-ML judging.** In the judge image, starting Python
   takes 67 ms, `import numpy` 0.5 s, `import pandas` 1.2 s and `import torch`
   4.4 s, and the judge starts a new process for every test. A PyTorch Submit
   with 5 tests spends ~22 s importing. **Done** (same day): a fork server
   imports heavy libraries once per submission and forks a fresh process per
   test. Results below.
3. **API p95 is the dashboard under a synchronized start.** All 100 learners
   loaded their dashboard in the same second (constant-VU start) and queued on
   20 MongoDB connections; 16% of dashboards took 250–500 ms, the rest under
   25 ms. Ramped profiles (`2k`, `50k`) don't start everyone at once.

### Not run yet

- `2k` and `50k` profiles: need a staging environment and, for 50k, several
  load generators (see README).

## 2026-11-21 — fork server for heavy Python

Real sandboxes, the judge code called directly (no queues), three
submissions judged at a time.

| | Old (process per test) | Fork server |
| --- | --- | --- |
| Reference solutions passing (238 Python-ML and SQL items, all tests) | — | 238 / 238 |
| Starter verdicts identical | — | 233 / 238 (the 5 others: old TLE, new WA, see below) |
| PyTorch submissions (26), average | 13.3 s | 7.7 s |
| One PyTorch submission alone, 4 tests | 11.4–12.2 s | 4.6–5.0 s |

The five changed verdicts were false time-outs: under load, importing PyTorch
plus the work took longer than the 6 s limit, so the learner got "Time limit
exceeded" for the judge's own start-up. With the fork server they get the
right verdict (wrong answer).

Only programs that import PyTorch, scikit-learn, SciPy or LangGraph use it (41
of 277 judged items): for light programs its ~0.6 s start-up costs more than it
saves (measured: plain Python and NumPy items were 5% slower with it).
Edge cases checked against the old path: infinite loop (TLE, next test still
judged), memory hog (MLE), non-zero exit (RE), no state shared between tests,
and a program that kills the fork server (that test fails, later tests fall
back to running directly).
