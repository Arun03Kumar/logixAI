# Deploying LogixAI

Everything needed to run LogixAI is text in this repository: Dockerfiles,
a Compose stack, a Helm chart and environment variables. It runs on any host
with Docker (one VM is enough for a few thousand users) or on any Kubernetes
cluster. The scaling roadmap is in [production-plan.md](production-plan.md);
this guide covers phase S1, packaging and deployment.

## What runs

| Component | Image | Port | Needs |
| --- | --- | --- | --- |
| web (Next.js) | `web` | 3008 | — |
| identity-service | `identity-service` | 3006 | MongoDB |
| problem-service | `problem-service` | 3001 | MongoDB |
| submission-service | `submission-service` | 3000 | MongoDB, Redis |
| exam-service | `exam-service` | 3007 | MongoDB, Redis |
| arena-service | `arena-service` | 3010 | MongoDB, Redis |
| billing-service | `billing-service` | 3011 | MongoDB |
| socket-service | `socket-service` | 3005 | Redis |
| evaluator-service (judge) | `evaluator-service` | 3002 | Redis, a Docker daemon |
| router (Caddy) | `caddy:2.8-alpine` | 80/443 | — |
| judge sandboxes | `python-ml:4`, `node-web:1` (+ public gcc/openjdk/python) | — | pulled by the evaluator |

Every service:

- is configured only by environment variables, checked at startup (it exits
  with a clear message when one is missing or invalid);
- answers `GET /healthz` (process up) and `GET /readyz` (MongoDB/Redis
  connected, not shutting down; 503 otherwise);
- on SIGTERM reports not-ready for `SHUTDOWN_DRAIN_MS` (5 s in production),
  then finishes in-flight requests and queue jobs and exits;
- keeps no state in memory that matters (sessions are JWTs, queues are in
  Redis, data in MongoDB), so you can run as many copies as you like.

### One public origin

The router serves everything from one domain, so the browser never makes
cross-origin calls and cookies stay first-party:

| Browser URL | Goes to |
| --- | --- |
| `https://DOMAIN/` | web |
| `https://DOMAIN/api/<service>/v1/...` | `<service>` at `/api/v1/...` (identity, problem, submission, exam, arena, billing) |
| `https://DOMAIN/realtime/socket.io/...` | socket-service |
| `https://DOMAIN/.well-known/jwks.json` | identity-service |

The routes are in `deploy/helm/logixai/files/Caddyfile`, which Compose and
Helm share. The web image reads its API URLs at runtime from `PUBLIC_*`
variables (`PUBLIC_ARENA_API_URL=https://DOMAIN/api/arena/v1`, ...), served to
the browser by `/runtime-config.js`; both deployments set them for you.

## Images

Built from the repository root:

```powershell
docker build -f deploy/docker/service.Dockerfile --build-arg APP=@logixai/arena-service --build-arg APP_DIR=arena-service --build-arg PORT=3010 -t logixai/arena-service .
```

```powershell
docker build -f deploy/docker/web.Dockerfile -t logixai/web .
```

`docker compose -f deploy/compose/compose.yml build` builds them all. JS
services (problem, submission, socket) also pass `--build-arg START=src/index.js`
(socket: `src/server.js`); Compose and CI already do.

Each image contains only its service, the workspace packages it uses and
production dependencies (`turbo prune`), runs as the unprivileged `node` user,
and has a Docker `HEALTHCHECK`. `.dockerignore` keeps `.env` files, keys and
build output out of every image.

**In CI**, `.github/workflows/images.yml` builds and pushes all images, the
judge images included, to `ghcr.io/<owner>/logixai/<name>` on every push to
`main` (tags: the commit sha and `latest`) and on version tags. Deploy a
specific build by its sha.

## Secrets and settings

| Variable | Used by | Notes |
| --- | --- | --- |
| `MONGODB_URI_BASE` | all with a database | Cluster URI **without** a database name; each service appends its own (`logixai-arena`, ...). Atlas: `mongodb+srv://USER:PASSWORD@cluster.xxxxx.mongodb.net` |
| `MONGODB_URI_OPTIONS` | same | e.g. `?retryWrites=true&w=majority` |
| `REDIS_PASSWORD` | Redis users | Required in production |
| `REDIS_HOST`, `REDIS_PORT`, `REDIS_TLS` | Redis users | Managed Redis: set `REDIS_TLS=true` |
| `JWT_PRIVATE_KEY` | identity | Ed25519 PKCS8 PEM: `openssl genpkey -algorithm ed25519`. Keep it stable; changing it signs everyone out |
| `JWT_KEY_ID` | identity | Change when rotating the key |
| `INTERNAL_API_TOKEN` | all | Shared secret for service-to-service calls; `openssl rand -hex 32` |
| `BOOTSTRAP_ADMIN_EMAILS` | identity | Accounts created with these emails become platform admins |
| `REFRESH_COOKIE_PATH` | identity | Public path of the auth routes; `/api/identity/v1/auth` behind the router (set by Compose/Helm) |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | billing | Empty = mock checkout, no real payments |
| `JUDGE_CONCURRENCY` | evaluator | Submissions judged at once per evaluator (each gets 1 CPU and up to 1 GB) |
| `JUDGE_IMAGE_REGISTRY` | evaluator | Where `python-ml` and `node-web` are pulled from, e.g. `ghcr.io/acme/logixai` |
| `CODE_RUNS_PER_MINUTE` | arena | Per-user limit on Run/Submit |
| `SHUTDOWN_DRAIN_MS` | all | Default 5000 in production |
| `RATE_LIMIT_STORE` | identity, billing | `redis` shares rate-limit counters across replicas (set by Compose/Helm); `memory` for local development. arena always uses Redis |
| `MONGO_MAX_POOL_SIZE`, `MONGO_MIN_POOL_SIZE` | all with a database | Connections per replica (default 20 / 0); see the connection budget below |
| `PUBLIC_*_API_URL`, `PUBLIC_SOCKET_URL` | web | Set by Compose/Helm from the domain |

Each service's own `.env.example` lists its full set with defaults.

## Option 1: Docker Compose (one or a few VMs)

Good for up to a few thousand users. Needs a Linux VM with Docker, ports 80
and 443 open, and a DNS record for your domain pointing at it.

1. Copy and fill in the settings (never commit the filled-in file):

   ```powershell
   Copy-Item deploy/compose/.env.example deploy/compose/.env
   ```

2. Build or pull the images. To build on the server:

   ```powershell
   docker compose -f deploy/compose/compose.yml --env-file deploy/compose/.env build
   ```

   Or set `REGISTRY` and `TAG` to the images CI pushed and `pull` instead.
   The judge images must be reachable too: either `JUDGE_IMAGE_REGISTRY`
   (CI pushes them) or build them on the server with `npm run judge:images`
   and leave `JUDGE_IMAGE_REGISTRY` empty.

3. Start everything:

   ```powershell
   docker compose -f deploy/compose/compose.yml --env-file deploy/compose/.env up -d
   ```

   The `*-migrate` services run first and exit; the apps start only if they
   succeed. Caddy gets the HTTPS certificate on the first request.

4. Updates: change `TAG`, then `pull` and `up -d` again (migrations run again,
   and do nothing if there's nothing new).

More judge capacity: `--scale evaluator=4`, or raise `JUDGE_CONCURRENCY`
(about one CPU per concurrent submission). To try it without Atlas, add
`--profile bundled-mongo` and set `MONGODB_URI_BASE=mongodb://mongo:27017`
(a single node without backups: not for real traffic).

**Judge hosts.** The evaluator starts sandbox containers through the host's
Docker socket, which is equivalent to root on that host. The sandboxes have no
network, no capabilities, a read-only filesystem and CPU/memory/process limits,
but for real traffic put evaluators on hosts that run nothing else. Run the
same Compose file there with only the evaluator: `up -d evaluator`, with
`REDIS_HOST` pointing at the shared Redis.

## Option 2: Kubernetes (Helm)

For more users, autoscaling and zero-downtime deploys. Works on any cluster
(EKS, GKE, AKS, DigitalOcean, k3s) with an Ingress controller.

1. Create the secret (values never go in a values file):

   ```powershell
   kubectl create secret generic logixai-secrets --from-literal=MONGODB_URI_BASE='mongodb+srv://USER:PASSWORD@cluster.xxxxx.mongodb.net' --from-literal=REDIS_PASSWORD='...' --from-literal=INTERNAL_API_TOKEN='...' --from-file=JWT_PRIVATE_KEY=jwt-ed25519.pem
   ```

   Add `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` and `RAZORPAY_WEBHOOK_SECRET`
   when payments go live.

2. Install, with your own values file for the domain, registry, tag, TLS
   and sizes (see `deploy/helm/logixai/values.yaml`):

   ```powershell
   helm upgrade --install logixai deploy/helm/logixai -f my-values.yaml
   ```

What the chart creates:

- a Deployment, Service, HorizontalPodAutoscaler (CPU, 2–10 pods) and
  PodDisruptionBudget per service, with readiness on `/readyz`, liveness on
  `/healthz`, rolling updates with no unavailable pods, and non-root,
  no-capability containers;
- **migration Jobs** as pre-install/pre-upgrade hooks: an upgrade stops if a
  migration fails, before any pod is replaced;
- the **router** (Caddy, same Caddyfile, plain HTTP) behind one Ingress that
  terminates TLS (use cert-manager or your cloud's certificates);
- **evaluator** pods with a Docker-in-Docker sidecar, because cluster nodes
  usually have no Docker daemon. The sidecar is privileged: give evaluators
  their own node pool (`evaluator.nodeSelector` and `tolerations`);
- optionally a single Redis StatefulSet (`redis.bundled`). For real traffic
  use a managed Redis and set `redis.bundled: false` and `redis.host`.

One release per namespace: Service names (`identity`, `arena`, ...) are fixed
so the router finds them.

## Scaling: shared limits, caching, connections

Services keep no per-process state that matters, so you scale by adding
replicas (`--scale arena=3`, or the Helm autoscalers). Three things make
that safe and cheap:

**Rate limits are shared.** Per-minute limits (sign-in attempts, code runs,
checkout calls) are counted in Redis, so 3 replicas still allow 10 sign-ins a
minute, not 30. If Redis is unreachable, requests are allowed rather than
refused. Daily and weekly quotas (free code runs, mock interviews) are
counted in MongoDB and were always shared. The router and services use the
real client IP: Caddy trusts `X-Forwarded-For` only from private addresses
(your load balancer or Ingress), and the services only from the router.

**Signed-out reads are cacheable.** Catalog endpoints (tracks, topics, items,
problems, courses, lists, skill map) answer signed-out requests with
`Cache-Control: public, max-age=60, s-maxage=300, stale-while-revalidate=600`,
a weak `ETag` (`304 Not Modified` when unchanged) and `Vary: Authorization`.
Contests (15 s / 30 s), public profiles (60 s / 120 s) and the DSA problem
bank (30 s / 60 s, as admins edit it) use shorter lifetimes. Signed-in
responses are `private, no-store` and are never shared. Put a CDN
(Cloudflare, CloudFront, ...) in front of the domain and it serves most
anonymous traffic, plus all static assets (`/_next/static`, immutable for a
year), without reaching the servers. CDN settings: respect origin cache
headers, and don't cache requests that carry an `Authorization` header.

**Connection budget.** Each replica opens up to `MONGO_MAX_POOL_SIZE`
connections (default 20), and idle ones close after a minute. Keep
`replicas × pool size`, summed over the services on one cluster, under the
cluster's limit, with room for migrations and tools:

| Atlas tier | Connection limit | Example |
| --- | --- | --- |
| M10 | 1,500 | 6 services × 3 replicas × 20 = 360 |
| M30 | 3,000 | 6 services × 10 replicas × 20 = 1,200 |
| M50 | 16,000 | autoscaling to 30 replicas each × 20 = 3,600 |

Most requests are a single indexed query, so 20 per replica is plenty; lower
it (10) when running many replicas rather than raising the tier. Every
per-user query (dashboard, review queue, daily run count, sessions) is backed
by an index starting with `userId`.

## The judge at scale

Code that can't run in the browser (Submit, PyTorch and LangGraph labs,
JavaScript, DSA problems, exams) goes to the judge through Redis queues.

- **One queue per image group**: `dsa` (C++, Java, Python), `python-ml` and
  `node-web`. A burst of slow PyTorch runs can't hold up DSA or exam code.
- **Priorities**: exam answers first, then Submits, then Runs.
- **Pools**: an evaluator serves the groups in `JUDGE_QUEUES`, e.g.
  `python-ml:3,dsa:2` (group:concurrency; empty = all groups at
  `JUDGE_CONCURRENCY`). Run separate evaluators per group to scale each on its
  own queue: in Compose, one host per pool with `up -d evaluator` and its own
  `JUDGE_QUEUES`; in Helm, list them under `evaluator.pools`.
- **Warm sandboxes**: each evaluator keeps `JUDGE_WARM_POOL` (default 1)
  started, unused containers per language, so a job doesn't wait for one to
  boot. Each submission still gets its own fresh container, destroyed after.
- **Autoscaling on the backlog**: `GET /queue-stats` on an evaluator returns
  `{ waiting, queues, warm }` for its groups. With KEDA installed, set
  `evaluator.autoscaling.mode: queue` and pods are added when more than
  `backlogPerPod` jobs wait per pod (CPU still applies too). Without KEDA,
  `mode: cpu` uses a normal HorizontalPodAutoscaler.
- **Backpressure**: while more than `JUDGE_BUSY_BACKLOG` (500) jobs wait, a
  server Run is answered at once with 429 "busy, try again"; Submits and exam
  answers are always queued.
- **Results are pushed**: ML Arena pages wait on
  `GET /api/v1/arena/submissions/:id/stream` (server-sent events) and get the
  verdict the moment it's applied, on whichever arena replica holds the stream
  (Redis pub/sub). They poll only if the stream can't be used. DSA and exams
  already push through socket-service.

## Before going live

- MongoDB Atlas: allow the servers' IPs (or VPC peering), use a dedicated
  database user per environment, and turn on backups.
- Rotate any credential that has ever been in a chat, log or commit.
- Set `BOOTSTRAP_ADMIN_EMAILS`, then sign up with that email.
- Push the judge images (CI does) and set `JUDGE_IMAGE_REGISTRY`.
- Check `https://DOMAIN/runtime-config.js` lists your API URLs and that
  `/api/arena/v1/tracks` answers.
- Health: every service's `/readyz` returns 200 (`docker compose ps` shows
  them healthy; `kubectl get pods` shows them Ready).
