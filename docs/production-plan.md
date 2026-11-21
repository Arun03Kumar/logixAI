# Production and scale plan (step 4)

Goal: deploy LogixAI on any platform from text files (Dockerfiles, Compose,
Helm, env vars), and stay fast at 2,000 active users with headroom for spikes
of 50,000, including the code editor and the Run button.

Status: **S1–S4 built** (see [deploy.md](deploy.md) and ml-arena.md "Run in the browser"); S5 not yet. Phases below, in order. Each one ships
on its own and is useful without the next.

## Where we are today

| Area | Today | Problem at scale |
| --- | --- | --- |
| Packaging | Services run with `npm run dev`; only the judge images have Dockerfiles; `docker-compose.yml` is dev-only (Mongo + Redis) | Nothing to deploy |
| Web | `next build` without `output: "standalone"` | Large images, needs the whole monorepo at runtime |
| Run / Submit | Every Run and Submit goes to the evaluator queue; one fresh container per submission; the browser polls for the result | Container start (0.5–2 s, more with torch) on every click; polling load grows with users |
| Judge workers | Fixed `JUDGE_CONCURRENCY` per process | No scaling with queue length |
| Rate limits | `@fastify/rate-limit` in memory | With 3 replicas, a user gets 3 × the limit |
| Health | No liveness/readiness endpoints | Orchestrators can't tell a broken instance |
| DB | Atlas, indexes via `db:migrate` (now sequential, with connect retries) | Pool sizes and tier not sized |
| Observability | Logs only | No metrics, no load tests |

## Capacity model

Assumptions for a peak of **50,000 concurrent users**: about 5% press Run or
Submit in a given minute, so roughly 2,500 judge requests a minute (about 40
a second). A server-side run costs about 1–1.5 CPU-seconds including container
start. That needs about 60 busy cores. At **2,000 users** it's about 2–3 cores.

Two things make the 50k case affordable:

1. **Run in the browser** (S3): Python with NumPy/Pandas/SciPy (Pyodide), SQL
   (DuckDB-WASM) and JavaScript/React (the sandboxed iframe we already have) run
   the *sample* tests on the learner's machine in well under a second, with no
   server cost. Only **Submit** (hidden tests, which must never reach the
   browser) and PyTorch/LangGraph items go to the server. That should remove
   70–80% of judge load.
2. **Warm containers and autoscaling** (S4) for what's left.

Targets (checked with k6 in S5):

| | 2,000 users | 50,000 users |
| --- | --- | --- |
| Page/API p95 | < 300 ms | < 500 ms |
| Run p95 (in browser) | < 1 s after first load | same (no server) |
| Run/Submit p95 (server) | < 3 s | < 6 s, queue never drops jobs |
| Errors | < 0.1% | < 0.5%, overload returns "busy, retry" not 500s |

## S1 — Deploy anywhere (packaging and config)

- A **Dockerfile per service** (multi-stage, `node:22-alpine`, non-root user,
  `npm ci --workspace`, only production deps, `HEALTHCHECK`), plus the web app
  with Next.js `output: "standalone"`.
- **`/healthz` (liveness) and `/readyz` (Mongo + Redis reachable)** on every
  service; **graceful shutdown** (stop accepting, finish requests and judge
  jobs, close connections) on SIGTERM.
- **`compose.prod.yml`**: every service + web + a reverse proxy (Caddy, with
  automatic HTTPS), optional bundled Mongo/Redis for a single-VM install, and
  a one-off `migrate` service that runs `db:migrate` before the apps start.
  One VM with `docker compose up` is a full deployment.
- **Helm chart** (`deploy/helm/logixai`): one Deployment per service,
  HorizontalPodAutoscaler on CPU, a migrate Job as a pre-upgrade hook, Ingress,
  and Secrets from env. Works on any Kubernetes (EKS, GKE, AKS, DigitalOcean, k3s).
- **Config is env only.** Complete `.env.example` per service, validated at
  startup (already done with Zod), and `docs/deploy.md` listing every variable.
  Managed MongoDB (Atlas) and Redis (Upstash/ElastiCache/Redis Cloud) by default.
- A **GitHub Actions** workflow: pipeline, then build and push images tagged
  with the commit SHA.

The judge needs a Docker daemon (it starts sandbox containers), so judge
workers run on **VMs or a dedicated node pool**, not on serverless platforms.
Everything else is stateless and runs anywhere.

## S2 — Stateless services, caching, shared limits

- **Rate limits in Redis** (the plugin's Redis store) so limits hold across
  replicas; the same for the free-tier daily run cap.
- **HTTP caching**: catalog reads that don't depend on the user (track and
  topic lists, item statements, problem lists signed out) get
  `Cache-Control: public, s-maxage=300` + ETag; content changes only on deploy,
  so a CDN (Cloudflare or CloudFront) can serve most anonymous traffic. Static
  assets, the preview runtime and Pyodide files are immutable and cached for a year.
- **Per-user reads** (dashboard, review queue, skill map) stay uncached but are
  checked with `.explain()` and kept to one indexed query each.
- **Connection budget**: Mongo pool sized per replica (total under the Atlas
  tier's limit); start at Atlas M30 for 50k, M10 for 2k.
- **Sessions stay JWT** (no server state), so any replica serves any request.

## S3 — Instant Run in the browser

**As built (2026-11-21):** one engine, Pyodide 0.27.7, runs both Python and
SQL items (it includes DuckDB), using the judge's own harness program, so
results match by construction; DuckDB-WASM wasn't needed. Items run in the
browser only after `content:browser-check` verified them against the judge
(199 of 202 candidates). JavaScript/React items still run on the judge: their
harness needs Node and jsdom, and porting it is a separate step. See
ml-arena.md, "Run in the browser". The original plan follows.

- A **browser runner** web worker with three engines, loaded on first use and
  cached: **Pyodide** (Python with numpy, pandas, scipy), **DuckDB-WASM** (SQL),
  and the existing **JS/React iframe**.
- The content build marks each item `run: browser` or `run: server`
  automatically (imports of torch, langgraph or other unsupported packages, or
  a time budget the browser can't meet, mean server). The build also runs the
  reference solution in Pyodide to prove the browser gets the same answers as
  the judge image.
- **Run** uses the browser for `run: browser` items (sample tests only, with a
  timeout and a "stop" button). **Submit** always goes to the server, so
  hidden tests and anti-cheat are unchanged. If the browser engine fails to load
  (old device, blocked CDN), Run falls back to the server.
- Free-tier run caps count only server runs.

## S4 — Judge at scale

- **Warm pools**: each worker keeps a few idle, pre-started sandbox containers
  per image (python-ml, node-web, DSA languages). A job takes one, runs and
  throws it away, and a replacement starts in the background. Removes
  container start from the user's wait while keeping one container per job.
- **Separate queues per image** (python-ml, node-web, dsa) and **priority**
  (contest and submit above run), so a burst of PyTorch runs can't starve a
  contest.
- **Autoscaling on queue length**: KEDA on Kubernetes (scale judge workers on
  BullMQ waiting jobs), or a small autoscaler for VM groups. Scale-to-zero
  outside peak hours is optional.
- **Backpressure**: when a queue is longer than N seconds of work, new Runs get
  a friendly "busy, try again" (429) instead of waiting minutes; Submits are
  always accepted and queued.
- **Push results instead of polling**: the browser gets results over
  Server-Sent Events (or the existing socket-service), with polling as a fallback.

## S5 — Load tests and monitoring

- **k6 scripts** (`load/`): browse, open an item, Run, Submit, contest start.
  Ramps to 2k and 50k virtual users against a staging stack, reporting p95s
  and errors against the targets above.
- **Metrics** (`/metrics`, Prometheus format): request latency per route,
  queue length and wait per queue, judge time per image, warm pool size, Mongo
  pool use. A Grafana dashboard and alerts (queue wait > 10 s, error rate,
  p95 over target).
- Structured JSON logs with a request id carried from web to services to judge.

## Order and size

| Phase | Ships | Rough size |
| --- | --- | --- |
| S1 | Dockerfiles, health, graceful shutdown, compose.prod, Helm, CI images, deploy doc | large |
| S2 | Redis rate limits, HTTP caching + CDN headers, pool sizing | small |
| S3 | Browser runner (Pyodide, DuckDB-WASM, JS) and the run-mode marker | large |
| S4 | Warm pools, per-image queues and priority, autoscaling, backpressure, SSE | large |
| S5 | k6 scripts, metrics, dashboard | medium |

Nothing here needs new paid services to start. Atlas and a Redis provider are
already assumed; a CDN and a Kubernetes cluster are optional (Compose on one or
two VMs covers 2,000 users).
