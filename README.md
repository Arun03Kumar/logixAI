# LogixAI

Monorepo for the LogixAI marketing site, coding platform (problem authoring,
in-browser IDE and a Docker-based judge), institution exams and ML Arena.

## Layout

```
apps/
  web/                 Next.js app: marketing site + coding platform    :3008
  identity-service/    Accounts, sessions, institutions, invites (TS)    :3006
  exam-service/        Institution exams: authoring, attempts, grading   :3007
  arena-service/       ML Arena: lessons, practice items, progress (TS)  :3010
  billing-service/     Plans and payments: Pro passes, Razorpay (TS)     :3011
  problem-service/     Problems CRUD (Express, MongoDB)                  :3001
  submission-service/  Accepts submissions, queues them (Fastify, Mongo) :3000
  evaluator-service/   Runs code in Docker, reports results (TS, BullMQ) :3002
  socket-service/      Pushes results to the browser (socket.io, Redis)  :3005
packages/
  ui/                  Design system: tokens, Tailwind theme, React components
  languages/           Language registry: ids, labels, Docker images, commands
  contracts/           Zod schemas + types for APIs, queue jobs and socket events
  service-kit/         Validated env config, logger, errors, response envelope,
                       Mongo and Redis helpers for backend services
```

Submission flow:

```
web --POST--> submission-service --SubmissionQueue--> evaluator-service (Docker)
                                                          |
web <--socket.io-- socket-service <--HTTP-- submission-service <--EvaluationQueue--+
```

## Getting started

Requires Node 22+, npm 11+ and Docker.

```bash
npm install            # installs every workspace from the repo root
npm run infra:up       # MongoDB + Redis via docker compose
npm run judge:images   # builds the Python + NumPy sandbox image for ML Arena
```

If Redis already runs on port 6379, start only MongoDB: `docker compose up -d mongo`.
Each backend service has its own database (`logixai-identity`,
`logixai-problems`, `logixai-submissions`, `logixai-exams`, `logixai-arena`); see
[docs/database.md](docs/database.md).

Copy each `apps/*/.env.example` to `.env` (for `apps/web`, to `.env.local`) and
adjust values. Each service validates its env on startup and exits with a clear
message if something is missing.

```bash
npm run db:migrate     # applies data migrations and builds indexes (every service)
npm run dev            # builds packages/*, then starts every app with hot reload
```

Run one app only: `npx turbo run dev --filter=@logixai/problem-service`.

## Common scripts (from the repo root)

| Script              | What it does                                   |
| ------------------- | ---------------------------------------------- |
| `npm run dev`       | Start all apps (shared packages build first)   |
| `npm run build`     | Build everything                               |
| `npm run typecheck` | Type-check every TypeScript workspace          |
| `npm test`          | Run every workspace's Vitest suite (`test/`)   |
| `npm run lint`      | Lint                                           |
| `npm run infra:up`  | Start MongoDB and Redis                        |
| `npm run db:migrate`| Migrations + index sync; run on every deploy   |
| `npm run content:build` | Validate ML Arena content, rebuild its tests |

## Conventions

- **Adding a language**: add an entry to `packages/languages/src/index.ts`. The
  DB enum, the judge's Docker images and the UI selectors all read from it.
- **Changing data passed between services** (HTTP bodies, queue jobs, socket
  events): change the schema in `packages/contracts` first. Producers validate
  queue payloads against it, so a mismatch fails loudly at the sender.
- **New backend config**: add it to the service's `loadConfig` schema and to its
  `.env.example`.
- **Tests** live in each workspace's `test/` folder. Pass collaborators in
  (repositories, HTTP clients) instead of requiring them inside functions, so
  logic can be tested without Mongo, Redis or Docker.
- **UI** ("Warm modern" design system in `packages/ui`):
  - Build screens from `@logixai/ui` components (`Button`, `Card`, `Badge`,
    `Tabs`, `Select`, `Input`, `EmptyState`, `PageHeader`, ...). If something
    is missing, add it to the package instead of styling it inline.
  - Colours only through tokens: `bg-background`, `bg-card`, `text-foreground`,
    `text-muted-foreground`, `border-border`, `bg-primary`, `bg-success-soft`,
    and so on. No hex values or Tailwind palette colours (`orange-500`) in app
    code. New colours go into `packages/ui/src/styles.css` with a dark-mode
    value.
  - Type: Plus Jakarta Sans for UI, JetBrains Mono for code. Weights 400,
    500, 600 and 700 for headings only. Smallest text is `text-xs` (12px).
  - At most one `primary` button per view; the rest are `secondary` or
    `ghost`.
  - No emoji as icons (use `lucide-react`), no gradients, glows or
    decorative animation. Sentence case for headings, buttons and labels.
  - The code editor is always dark (`vs-dark`), in both page themes. Use
    `editorOptions()` from `components/problem/editorConfig.js`.
- **Accounts and access** (identity-service):
  - Sign-in gives the browser a short-lived access token (JWT, 15 min, kept in
    memory) and a rotating refresh token in an httpOnly cookie. The web app's
    `authFetch` (`apps/web/app/lib/auth/session.js`) attaches the token and
    refreshes it automatically.
  - Other services verify tokens with identity-service's public keys
    (`/.well-known/jwks.json`) via `createAccessTokenVerifier` from
    `@logixai/service-kit`. Never trust a user id sent in a request body.
  - Platform roles: `user`, `admin`. Creating, editing or deleting problems
    needs `admin`. Emails in identity-service's `BOOTSTRAP_ADMIN_EMAILS` get
    `admin` when they sign up.
  - Institution roles: `owner` > `admin` > `dept_head` > `instructor` >
    `assistant` > `student` (see docs/institutions.md). People join with a
    code at `/join/<code>`, a CSV import, or their email domain; students
    without email sign in with institution code + roll number.
  - In production set `JWT_PRIVATE_KEY` (identity-service) and the same
    `INTERNAL_API_TOKEN` in problem-service, submission-service and
    socket-service (they refuse to start without it).
- **Judge** (evaluator-service):
  - One container per submission: the code is written once, compiled once,
    then every test runs in the same container with `docker exec`. Code and
    test input go in as files, never through shell quoting.
  - Each sandbox has no network, drops all Linux capabilities, runs as
    `nobody` on a read-only image with small tmpfs mounts, and is limited in
    memory (per language), CPU (1 core) and processes (128).
  - Verdicts: `SUCCESS`, `WA`, `TLE`, `MLE`, `RE`, `CE`, plus `ERROR` when
    the judge itself failed. Output comparison ignores trailing spaces, blank
    lines at the end and Windows line endings.
  - Time limit per test = `BASE_TIME_LIMIT_MS` (2 s) × the language's
    multiplier (C++ 1, Java 2, Python 3). Throughput scales with
    `JUDGE_CONCURRENCY` per process and with more evaluator instances.
  - Sandbox tests against real Docker: `JUDGE_DOCKER_TESTS=1 npx vitest run`
    in `apps/evaluator-service`.
- **Practice problems**: tests are either examples (shown, used by Run) or
  hidden (Submit only). The public problem API never returns hidden tests or
  the hidden code around the student's code; submission-service reads them
  from `GET /problems/:id/judge`, which needs `INTERNAL_API_TOKEN` (or a
  platform admin). Results sent to the browser blank the output of hidden
  tests.
- **Exams** (exam-service, database `logixai-exams`):
  - Instructors and admins create exams with single-choice, multiple-choice
    and coding questions, assign batches and a time window, then publish.
    Published exams are locked; unpublish (only before anyone starts) to edit.
  - Coding questions keep their hidden tests in exam-service; they never
    reach the browser. The judge is shared with practice: a submission job
    names its `replyQueue`, so exam results go to `ExamEvaluationQueue` and
    practice results to `EvaluationQueue`.
  - Each student gets one attempt with a server-side deadline
    (`min(start + duration, window close)`). Answers autosave; attempts are
    auto-submitted when time runs out (also by a 30 s sweep for closed tabs).
  - Integrity signals (tab switches, leaving fullscreen, copy/paste attempts)
    are recorded for instructors to review. They are signals, not proof.
  - exam-service checks institution roles by forwarding the caller's token to
    identity-service (`GET /institutions/:id`).
- **ML Arena** ([docs/ml-arena.md](docs/ml-arena.md)): content is YAML in
  `apps/arena-service/content`, written with reference solutions; run
  `npm run content:build` after changing it. Code items use the `PYTHON_ML`
  runtime and are compared as JSON with a float tolerance, outside the sandbox.
- **Plans** ([docs/billing.md](docs/billing.md)): identity-service decides who
  has Pro (personal pass or institution contract) and puts `plan`/`planUntil`
  in the access token; check it with `hasPro(claims)` from
  `@logixai/contracts`. billing-service sells passes via Razorpay and uses a
  mock checkout in development when no keys are set.
- **Institutions** ([docs/institutions.md](docs/institutions.md)): only
  platform admins create institutions, from `/admin/institutions`. Six roles
  with capabilities (`capabilitiesFor` in `@logixai/contracts`); owners and
  admins see everything, everyone else only their batches. Services read the
  caller's `access` and the institution's `features` from
  `GET /institutions/:id`. Onboarding (CSV import, roll-number sign-in,
  approvals, email domains, QR invites, year rollover) and test features
  (written answers and grading, question bank, sections, negative marks,
  extra time, rank, re-evaluation) are in the same doc.
- **Data** ([docs/database.md](docs/database.md)): one database per service,
  indexes declared in the models, data changes as migrations in
  `src/db/migrations`, lists paged by cursor (`{ items, nextCursor }`), and
  institution/exam/problem changes recorded in `audit_events`.
- **Lockfile**: root `optionalDependencies` pin lightningcss's platform
  binaries. npm otherwise drops them from `package-lock.json` (npm bug), which
  breaks `next build`. Bump them together when Tailwind updates lightningcss.
- Install dependencies from the root: `npm install <pkg> -w @logixai/<app>`.
