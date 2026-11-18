# Database guide

How LogixAI stores data, how to change it safely, and how to run it in
production. Read this before adding a collection, an index or a field.

## Layout

Each service owns one database and nothing else reads or writes it. Services
talk to each other over HTTP or queues, never through another service's
collections. That keeps each service free to change its own schema, and lets a
busy database move to its own cluster later without code changes.

| Service            | Database              | Collections                                                                 |
| ------------------ | --------------------- | --------------------------------------------------------------------------- |
| identity-service   | `logixai-identity`    | users, refreshtokens, institutions, memberships, batches, invites, audit_events |
| problem-service    | `logixai-problems`    | problems, audit_events                                                      |
| submission-service | `logixai-submissions` | submissions                                                                 |
| exam-service       | `logixai-exams`       | exams, attempts, audit_events                                               |
| arena-service      | `logixai-arena`       | item_progress, submissions, user_stats (content is in the repo, not the DB) |

Every database also has `_migrations` (applied migration ids) and
`_migrations_lock` (stops two deploys migrating at once).

The database name is the path of `DB_CONNECTION_STRING`, for example
`mongodb+srv://user:pass@cluster.example.net/logixai-exams`.

Redis holds only queues (BullMQ) and socket.io fan-out, nothing that isn't
also in MongoDB. Losing Redis loses jobs in flight, not data.

## Changing the schema

1. Change the Mongoose model. Declare every index in the model
   (`schema.index(...)`), never by hand in the Atlas UI: the model is the
   source of truth, and `db:migrate` drops indexes the model doesn't declare.
2. If existing documents need changing (a rename, a backfill, a new required
   field), add a migration to the service's `src/db/migrations` file. Give it
   the next id (`YYYY-MM-DD-NN-short-name`) and make it safe to run on a
   database where it partly ran (filter on the old shape, as the existing
   ones do). Never edit or rename a migration after it has run anywhere.
3. Run `npm run db:migrate` (all services) or
   `npm run db:migrate -w @logixai/<service>` against your dev database.
   It applies pending migrations in id order, then syncs every model's
   indexes.

In production, run `npm run db:migrate` on every deploy before starting the
new version. Services start with `autoIndex` off when `NODE_ENV=production`, so
a deploy never builds indexes on a busy cluster by surprise. In development
`autoIndex` stays on for convenience.

Rules of thumb:

- Every query a page or endpoint makes needs an index that matches its filter
  and sort. Check with `.explain()` when adding a query.
- Lists are paginated by cursor (`?limit=&cursor=`, at most 100 per page),
  never by `skip`. Responses look like `{ items, nextCursor }`; `nextCursor`
  is `null` on the last page. Use `encodeCursor`, `decodeCursor` and `toPage`
  from `@logixai/service-kit` and `PageQuerySchema` from `@logixai/contracts`.
  In the web app, use `usePagedApi` and `<LoadMore>`.
- Totals and averages come from the database (an aggregation), not from
  whatever page the browser has loaded. See `summarizeExam` in exam-service.
- Large exports are built server-side a page at a time (see
  `GET /exams/:id/results/export`).
- Don't store what you can't protect. Passwords are salted scrypt hashes; refresh
  tokens are stored as SHA-256 hashes; submissions store only the student's
  code, never the hidden template around it.

## Audit log

Changes that matter to an institution or to the problem bank are written to
`audit_events` in the service that made them: who (`actorId`), what
(`action`, one of `AUDIT_ACTIONS` in `packages/contracts/src/audit.ts`), on
what (`targetType`, `targetId`), when (`at`) and small non-sensitive details
(`meta`). Never put passwords, tokens or exam answers in `meta`.

Admins and owners can read them:

- `GET /api/v1/institutions/:id/audit` (identity-service: members, batches, invites)
- `GET /api/v1/institutions/:id/exam-audit` (exam-service: exams)

Audit writes are best effort: a failed write never fails the change itself. The log is append-only; no code updates or deletes events.

## Database users (least privilege)

Each service should connect as its own database user that can only read and
write its own database. Then a bug or leaked `.env` in one service can't touch
another service's data.

In MongoDB Atlas (do this for each row in the table above):

1. Open your project, then **Security > Database Access > Add New Database
   User**.
2. Authentication method: **Password**. Username: the service name, e.g.
   `exam-service`. Click **Autogenerate Secure Password** and copy it.
3. Under **Database User Privileges**, open **Specific Privileges** and add
   **readWrite** on database `logixai-exams` (the service's database). Leave
   the collection field empty. Add nothing else.
4. Click **Add User**.
5. In `apps/exam-service/.env`, set
   `DB_CONNECTION_STRING="mongodb+srv://exam-service:<password>@<cluster-host>/logixai-exams?retryWrites=true&w=majority"`.
   If the password has characters like `@`, `:` or `/`, URL-encode them.
6. Restart the service and check its log says
   `Connected to MongoDB (database "logixai-exams")`.

`readWrite` is enough for `db:migrate` too: it can create collections and
indexes in that database. Keep your own admin user for the Atlas UI only, and
don't put it in any service's `.env`.

Also in Atlas, under **Security > Network Access**, allow only the IP
addresses your servers use. `0.0.0.0/0` (anywhere) is fine for a quick test,
not for real student data.

## Production setup

The free M0 cluster is fine for building, not for schools:

- No backups at all, shared CPU, 512 MB storage, and Atlas may pause it.

When institutions start using LogixAI:

1. Create a separate Atlas **project** for production, so dev users and
   network rules can't reach it.
2. Create a dedicated cluster, **M10 or larger**, region **Mumbai
   (ap-south-1)**: lowest latency for Indian schools and keeps student data in
   India.
3. Turn on **Cloud Backup** with continuous backup (point-in-time restore).
4. Create one database user per service as above, with passwords stored in
   your hosting provider's secret store, not in files on the server.
5. Allow only your servers' IPs in Network Access.
6. For Redis use a managed instance with a password and TLS
   (`REDIS_PASSWORD`, `REDIS_TLS=true`). Services refuse to start in
   production without `REDIS_PASSWORD`. Set its eviction policy to
   `noeviction` (BullMQ requires it).
7. Deploy order: `npm run db:migrate`, then start the services.

Personal data: LogixAI stores names, emails, institution membership, exam
answers and code. Under India's DPDP Act, users can ask what you hold about
them and ask for it to be deleted, and you must protect it with reasonable
safeguards. Plan a per-user export and delete (across all four databases)
before onboarding schools.

## Backups and restore

With Atlas Cloud Backup (M10+) backups are automatic. Test a restore every few
months; a backup you've never restored is a guess.

Restore one database to a point in time (Atlas UI): **Clusters > ... > Backup
> Restore**, choose the time, restore to a *new* cluster, check the data, then
switch the service's `DB_CONNECTION_STRING` (or copy the collection back with
`mongodump`/`mongorestore`).

Manual backup (any tier, including M0), using MongoDB Database Tools:

```powershell
mongodump --uri "<connection string>/logixai-exams" --archive=logixai-exams-2026-11-18.gz --gzip
```

Restore it into a database (here a copy, to check it first):

```powershell
mongorestore --uri "<connection string>" --archive=logixai-exams-2026-11-18.gz --gzip --nsFrom "logixai-exams.*" --nsTo "logixai-exams-restore.*"
```

Store dumps somewhere other than the server, and treat them like the
database: they contain personal data.

## History: the November 2026 split

Before 2026-11-18, problem-service and submission-service shared the `test`
database and identity-service used `users`; exam-service used a local MongoDB.
Their data was copied into the four databases above (old submissions had the
hidden template code stripped on the way), and every `.env` now points at the
new databases. The old `test` and `users` databases were left untouched as a
fallback. Once the new ones have worked for a while, drop `test` and `users`
in Atlas (**Collections**, hover the database, trash icon).
