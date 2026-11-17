# LogixAI

Monorepo for the LogixAI marketing site and coding platform (problem authoring,
in-browser IDE and a Docker-based judge).

## Layout

```
apps/
  web/                 Next.js app: marketing site + coding platform    :3008
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
```

Copy each `apps/*/.env.example` to `.env` (for `apps/web`, to `.env.local`) and
adjust values. Each service validates its env on startup and exits with a clear
message if something is missing.

```bash
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
- **Users**: until accounts exist, each browser gets a random anonymous id
  (`apps/web/app/coding-platform/lib/clientUserId.js`), used for both the
  submission and the socket registration.
- Install dependencies from the root: `npm install <pkg> -w @logixai/<app>`.
