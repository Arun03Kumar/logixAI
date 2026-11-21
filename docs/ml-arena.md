# ML Arena

Practice for the maths, Python/NumPy and machine learning behind real models:
short lessons, then items learners solve by calculating, predicting output and
writing code that's judged against hidden tests. Web routes live under
`/arena`; the backend is `apps/arena-service` (port 3010, database
`logixai-arena`).

## How it fits together

```
web /arena ──► arena-service ──SubmissionQueue──► evaluator-service ──► Docker sandbox
                    ▲                                   │              (logixai/python-ml:4)
                    └──────── ArenaEvaluationQueue ◄────┘
identity-service ── JWKS ──► arena-service (verifies access tokens)
identity-service ◄── caller's token ── arena-service (institution roles, batches, members)
```

- **Content** (tracks, topics, lessons, items, answers, reference solutions)
  lives in `apps/arena-service/content/` as YAML, reviewed in git, and is
  loaded into memory when the service starts. The service refuses to start if
  the content is invalid or its generated tests are out of date.
- **Progress** (per-item status and review schedule, code submissions, XP and
  active days) is in MongoDB: collections `item_progress`, `submissions`,
  `user_stats`; institutions add `track_assignments` and `audit_events`; mock
  interviews and contests use `practice_sessions`, public profiles `profiles`.
- **Code items** go through the same evaluator as practice problems and exams,
  using the `PYTHON_ML` runtime (Python 3.12 with NumPy, Pandas, SciPy,
  scikit-learn, PyTorch 2.5 (CPU build), DuckDB for SQL items, and LangGraph 0.2
  with LangChain core for the LLM labs; CPU only, no model providers). Build its image
  (`logixai/python-ml:4`) with `npm run judge:images`, and again whenever its
  tag changes — the evaluator only runs images that exist locally.
- **JavaScript and React items** use the `NODE_WEB` runtime: Node 22 with
  React 19, jsdom and Sucrase (image `logixai/node-web:1`, built by the same
  `npm run judge:images`).

## Item types

| Type | Learner does | Graded |
| --- | --- | --- |
| `mcq_single`, `mcq_multi` | picks options | instantly, by the service |
| `numeric` | types a number | instantly, within `tolerance` |
| `output` | types what a snippet prints | instantly (trailing whitespace ignored) |
| `code` | implements a function | by the judge, sample + hidden tests |
| `debug` | fixes broken code | by the judge, like `code` |
| `code` + `dataset` | trains a model on a CSV, predicts held-out rows | by the judge: a metric (accuracy, f1, r2, rmse, mae) must reach a threshold |
| `sql` | writes a SQL query (DuckDB) | by the judge, on a sample dataset and hidden datasets; the rows returned are compared |
| `code` / `debug` with `language: javascript` | writes JavaScript or a React component (JSX) | by the judge in Node; React items render in jsdom |
| `output` with `language: javascript` | types what a Node snippet prints | instantly |
| `design` | writes an open-ended design (e.g. "design a URL shortener") | self-checked: after submitting, the learner sees a rubric and model answer and ticks what they covered; `passShare` (default 70%) of the points counts as solved |

XP is awarded once per item, on the first solve (easy 10, medium 20, hard 40,
expert 80). Revealing an answer first gives no XP. Mastery is the
difficulty-weighted share of a topic's items solved. Streaks count days
(India time) with any practice.

## How code is judged

1. arena-service wraps the learner's code in a small harness
   (`src/content/harness.ts`). The code is compiled as `solution.py` in its own
   namespace, so tracebacks point at the learner's line numbers and
   `if __name__ == "__main__":` blocks don't run. `print()` output goes to
   stderr.
2. For each test the harness reads the arguments, converts `ndarray` params to
   NumPy arrays, `tensor` / `tensor_int` params to PyTorch tensors (float32 /
   int64) and `dataframe` params to pandas DataFrames, calls the function
   and prints only the return value as JSON (tensors as nested lists). A returned DataFrame is compared
   by its columns and rows (the index is ignored); a Series like a dict.
3. The evaluator compares that JSON with the expected value **outside** the
   sandbox, with a tolerance for floats (`checker: json`). Expected outputs
   never enter the sandbox, so the only way to pass is to compute the answer.
4. For hidden tests the learner sees only the verdict, never error text, since
   code could print the hidden inputs to stderr and raise.
5. **Dataset challenges** use `checker: metric`: the function gets `(train, test)`
   DataFrames and returns one prediction per test row; the evaluator scores them
   against the true labels and reports only the score. Run trains on part of the
   training rows and predicts a validation split; Submit trains on all of them
   and predicts the held-out rows. The split is deterministic (seeded) and
   computed by arena-service from the CSV.

### Class-based items (test drivers)

Some questions ask for a class, not a function — an `nn.Module`, a
`torch.autograd.Function`, a training loop. Such an item has a `driver`:
Python that runs after the learner's code in the same namespace and defines
the function the tests call (`function.name`, usually `check`). The driver
builds the learner's class, loads fixed weights (`load_state_dict`,
`copy_`), calls it and returns what to compare — outputs, parameter names, or
named true/false checks for behaviour that's random or iterative (Dropout, a
training loop reaching a loss). Learners see the driver as "How your code is
tested", so it must never contain the answer.

PyTorch items should use a tolerance of about `1e-4` (float32), seed any
randomness inside the driver (`torch.manual_seed`, `torch.Generator`), and
for training check a threshold rather than exact weights.

### JavaScript and React items

A code item with `language: javascript` is compiled with Sucrase (JSX and
`import`/`export` allowed; only `react` and `react-dom` can be imported) and
run as `solution.js`, so stack traces show the editor's lines. Without a
driver the tests call the learner's function directly (`function.name`, any
JSON arguments). With a driver, `expose` lists the names the driver uses
(functions, classes, components, hooks), and the driver gets them as local
variables plus a toolkit, `__lx` (see `src/content/harnessJs.ts`):

- `__lx.useFakeTimers()` replaces `setTimeout`, `setInterval` and
  `Date.now()`; `await clock.tick(ms)` fires due timers in order, so debounce,
  retry and race-condition tests are exact and instant;
- `await __lx.render(<Comp />)` renders into jsdom; `__lx.click`, `__lx.type`,
  `__lx.keyDown` act like a user (wrapped in React's `act`); `__lx.byText`,
  `__lx.byTestId`, `__lx.$`, `__lx.text` read the page. Wrap clock ticks that
  update React state in `__lx.act(() => clock.tick(ms))`.

A program that never settles (a promise left pending) fails with a clear
message instead of passing silently. `content:build` runs each test in its own
Node process, like the judge, and still uses Python `tests.generate` for extra
cases. Items with `preview: { component, props }` also render live next to the
editor (see below).

### LLM and LangGraph labs

The *LLM apps and agents* track is Python. Retrieval, tokenisation and agent
problems are plain functions; LangGraph labs ask for a builder
(`build_graph()`, `build_agent(model, tools)`) that the driver compiles and runs.
Models are **scripted fakes** written in the driver — an object whose
`invoke(messages)` returns the next `AIMessage` (possibly with tool calls), or a
function that replies based on what's in `messages` — so labs are offline,
free and deterministic. Drivers convert LangChain messages to plain lists
before returning, since only JSON values are compared. The image pins
LangGraph 0.2.62 and langchain-core 0.3.29; when bumping them, rebuild and
re-read the LangGraph items' outputs (APIs such as `interrupt_before` and
`tools_condition` have changed across versions).

### Simulation charts and design questions (system design)

The *System design you can run* track uses JavaScript items whose components
take the current time as an argument (`allow(key, now)`), so a driver can
replay traffic deterministically. An item's `visual` charts each test's
output in the player: `timeline` for `[time, allowed]` / `[time, key, allowed]`
rows (green allowed, red rejected) and `bars` for `{ label: number }` (load per
server); `field` picks a property of the output. On a wrong answer the
expected and returned charts sit side by side.

`design` items have a `rubric` (3–30 points with ids), a `modelAnswer` and the
usual `explanation`. The rubric and model answer are only sent after the
learner has written something (at least 200 characters) or revealed the item.
The first submission (`{ text }`) records the design; a second one with
`checked` (rubric ids) records the self-check. Unknown ids don't count. There
is no automatic grading, so no AI cost.

When a driver returns named true/false checks, read the generated outputs
after `content:build`: the build records whatever the reference returns, so a
reference bug that makes a check `false` would otherwise go unnoticed.

### Live preview and the playground

The web app bundles `apps/web/preview-runtime/runtime.js` (React, ReactDOM,
Sucrase) into `public/arena-preview/runtime.js` before `dev` and `build`
(`scripts/build-preview.mjs`; the output is git-ignored). The page fetches it
once and inlines it into an iframe's `srcdoc` with `sandbox="allow-scripts"`
only, so learner code gets an opaque origin and can't read the app's cookies,
storage or page (checked). It's inlined because some browsers refuse script
requests from an opaque origin. React items show it as a "Live
preview" tab; `/frontend/playground` (formerly `/practice/playground`, which
now redirects) is a free-form React / JavaScript
scratchpad built on it (drafts stay in the browser). An infinite loop can still
freeze the tab; the restart button reloads the frame.

### SQL items

A `sql` item names a **database** (tables and named datasets, defined in
`content/sql-databases.yaml` or in the topic's own `databases`) and picks
datasets as its sample and hidden tests. Each test's input is that dataset; the
harness creates the tables in an in-memory DuckDB (one thread, 256 MB), runs
the learner's SQL and prints `{"columns": [...], "data": [[...]]}`:

- the **last statement** must be a query (`SELECT`, `WITH ... SELECT`, `VALUES`);
  earlier statements (`CREATE TEMP TABLE ...`) are allowed;
- column names are lower-cased, so `ID` and `id` both match; the names must
  be the ones the question asks for;
- unless the item sets `ordered: true`, rows are sorted before comparing, so
  any order passes;
- decimals and floats are compared with the item's tolerance; dates come back
  as `"2024-01-31"`; at most 2,000 rows.

Expected rows come from running the reference query at content-build time,
like code items. The learner sees the sample tables, the expected result and,
after a run, their own result next to it with differing rows highlighted.
Hidden datasets (more rows, ties, NULLs, empty groups) are never sent to the
browser.

Sandbox limits are the judge's usual ones (no network, no capabilities,
read-only filesystem, `nobody` user), with 512 MB of memory and a per-test time
limit of 6 s (2 s × 3 for Python). A learner can have one run in the judge at a
time and 12 runs per minute (`CODE_RUNS_PER_MINUTE`).

## Learning features

- **Spaced repetition.** Solving an item schedules a review a day later. Answering
  it correctly when it's due (or passing a submit, for code) pushes the next
  review out: 1 → 3 → 7 → 16 → 35 → 90 days; a miss starts over at 1. Reviews
  never give XP. `/arena/review` lists what's due and what was tried but not
  solved; `?review=1` on an item hides the earlier answer and the solution
  until the learner gets it right.
- **Skill map.** Topics and their `prerequisites` form a graph (`/arena/skills`).
  A topic counts as *struggling* when mastery is under 50% and there have been
  4+ attempts on its unsolved items; its *root causes* are prerequisites (two
  levels down) under 50% mastery.
- **Recommendations** (dashboard): due reviews, then where the learner left
  off, then up to three items from a struggling topic's root causes, then new
  topics whose prerequisites are covered.
- **Institutions.** Instructors and admins assign tracks to batches (with an
  optional due date) from the institution page's *ML Arena* tab and see a batch
  report: per student, mastery per topic, XP and last activity, plus the
  batch's weakest topic. Students see assigned tracks on `/arena`. arena-service
  asks identity-service for roles and batch members with the caller's own token
  (`IDENTITY_API_URL`). Assignments are recorded in `audit_events`
  (`GET /api/v1/arena/institutions/:id/audit`, admins).

## Areas

Content is split into three **areas** (`AREAS` in `@logixai/contracts`):
`ml`, `frontend` (JavaScript, React, the playground) and `system-design`. Every
track, curated list and mock template declares its `area`; a list or mock may
only use items from its own area (checked at load time).

| Area | Web home | Covers |
| --- | --- | --- |
| `ml` | `/arena` | maths, Python, NumPy, Pandas, SQL, ML, PyTorch, LLMs, the course |
| `frontend` | `/frontend` | JS and React tracks, `/frontend/playground` |
| `system-design` | `/system-design` | system-design problems |

Item, track, topic and problem pages are shared and re-exported under each
area's prefix; `apps/web/app/lib/areas.js` builds links (`itemHref`,
`topicHref`, `trackHref`) and redirects a page opened under the wrong prefix
(`/arena/items/react-keys` → `/frontend/items/react-keys`). The API takes
`?area=` on `/tracks`, `/lists`, `/courses`, `/problems`, `/me/dashboard`,
`/me/review` and `/skill-map`, so each area's dashboard, review queue, solved
count and skill map show only its own material.

## Courses

`content/courses.yaml` defines guided courses (currently *Machine learning,
from zero*, area `ml`, shown on `/arena` and `/arena/course/:courseId`). A
course is an ordered list of **modules**:

- an available module points to a track (`track: course-m1-maths`) whose
  topics are the module's **sections**, in order;
- a planned module has `status: planned` and no track yet;
- either kind can list existing tracks to practise with (`practice: [...]`).

`GET /api/v1/arena/courses?area=ml` lists courses; `GET /courses/:courseId`
returns modules with progress and the next section to study. Course tracks
are hidden from the general "Practice tracks" list (they carry `courseId`).

**Adding material from new PDFs:**

- *A new section in an existing module*: write
  `content/course-mN-<name>/<topic>.yaml` (lesson plus items, same format as
  any topic) and add its id to that folder's `track.yaml`, in order.
- *A new module*: create a `content/course-mN-<name>/` track folder (with
  `area: ml` and a negative `order` so it sorts with the course), then in
  `courses.yaml` replace the planned module's `status: planned` with
  `track: course-mN-<name>` (or add a new module with the next number).

Then run `npm run content:build`. Lessons are written in our own words from
the source material, never copied text. Numeric and multiple-choice answers
aren't checked by the build, so work them out by hand.

## Adding or changing content

Each track is a folder with `track.yaml` (title, level, ordered topic ids) and
one `<topic>.yaml` per topic: lesson (Markdown with `$maths$`), prerequisites
and items. The schema with comments is `apps/arena-service/src/content/schema.ts`;
copy an existing item as a template.

Shared test data, usable from any topic:

- `content/sql-databases.yaml` — SQL practice databases (`shop`, `hr`, `app`),
  each with a visible `small` dataset and hidden `full` / `edge` ones. Adding
  rows changes every item's expected output; just rebuild.
- `content/frames.yaml` — DataFrames that code items' tests use as
  `{ $frame: orders_a }` (`_a` versions appear in examples, `_b` in hidden tests).
- `content/lists.yaml` — curated lists ("SQL interview set", "ML coding
  round", ...) shown on `/arena/problems` and `/practice`. Every id must exist.

```powershell
npm run judge:images     # once, or after changing judge-images/python-ml
npm run content:build    # validates everything, writes tests.generated.json
```

`content:build` runs in the judge image and:

- runs every code item's reference solution on its sample and hidden tests,
  plus any generated with `tests.generate` (a seeded `cases(rng)` function),
  and records the expected outputs;
- checks hand-written `expected` values against the reference solution;
- checks every starter (or a debug item's broken code) **fails** at least one
  test;
- runs every `output` snippet and checks the answer is exactly what it prints;
- runs every SQL item's reference query on all its datasets, and refuses items
  whose answer is empty everywhere, whose datasets all give the same answer
  (hidden tests would catch nothing), or whose starter query already passes;
- for dataset challenges, checks the reference solution reaches the threshold
  on both the validation and the held-out rows, and the starter doesn't (it
  prints both scores, which helps set a fair threshold).

Datasets live in `content/datasets/*.csv` (header row, comma-separated, empty
cell = missing). The current ones are synthetic and generated by
`scripts/datasets/make_datasets.py` (seeded; the usage is in the file).

Commit both the YAML and `content/tests.generated.json`. CI (or you) can run
`npm run content:check` to fail when the generated file is stale.

Rules for writing items:

- Never edit an item's `id` once learners have used it; progress is keyed by it.
- Include at least one edge case in hidden tests (empty input, zeros, a single
  element) and a generator for larger random cases.
- Explanations say *why*, and name the misconception behind wrong answers.
- Write original questions. For "company style" tracks, label them as
  "in the style of", never as real interview questions.
- SQL and DataFrame answers: say which columns to return and, when order
  matters, how to sort and break ties.
- YAML: quote text containing `: `, and don't use bare `null`, `yes` or `no`
  as tags (they parse as values).

## Not built yet

Planned for later phases: arena items inside institution exams, CSV export of
batch reports, GPU and larger deep-learning models, HTML/CSS problems,
Python versions of the system-design problems, AI feedback on design answers,
LangChain (non-LangGraph) and vector-database labs, contest-only questions
(contests reuse catalog items), ratings across contests, institution-run
contests, and AI features (hints, interviewer). SQL runs on the server
for now; running queries in the browser (DuckDB-WASM) for instant feedback is a
possible later step.

## Practice hub and problem list

- `/practice` — the entry point (header *Practice*): interview tracks (SQL,
  Pandas, NumPy, PyTorch, JavaScript and React, system design, LLM apps and
  agents), curated lists,
  DSA problems, ML foundations and the playground.
- `/practice/playground` — React / JavaScript scratchpad with a live preview.
- `/arena/problems` — every ML Arena problem with filters; the filters live in
  the URL (`?type=sql&difficulty=hard&list=sql-interview-set`).

API (arena-service, `/api/v1/arena`, signed in or not):

| Route | Returns |
| --- | --- |
| `GET /problems?q=&type=&difficulty=&status=&track=&tag=&list=&access=` | every matching problem with topic, track and tags, plus tag counts; `status` (solved, attempted, todo) needs sign-in |
| `GET /lists` | curated lists with item and solved counts |

Items with `access: pro` are locked for users without Pro, and free users
have a daily cap on code runs; see [billing.md](billing.md).

## Mock interviews, contests and profiles

Both mock interviews and contests are **sessions** (`practice_sessions`): a
set of questions and a time window. Learners solve the questions on the normal
item pages (`?session=ID` adds a banner with the clock). ArenaService reports
every graded answer and every judged **Submit** (not Run) through an
`onOutcome` hook, and each open session containing that item records it:
solved time, wrong attempts before the solve. A learner has at most one open
session; solutions can't be revealed for its questions until it ends.

- **Mock interviews** — templates in `content/mocks.yaml`: slots of
  `count` questions drawn from tracks (optionally topics), item types and
  difficulties, unsolved items first. Free learners get free items only and
  3 mocks per rolling week (`FREE_MOCKS_PER_WEEK`); Pro is unlimited. The
  report scores difficulty-weighted solves (≥ 70% "Strong", ≥ 40%
  "Borderline") and lists the topics of missed questions.
- **Weekly contests** — `content/contests.yaml` defines a schedule, not
  individual contests: contest *n* (`weekly-n`) starts `firstStart + (n − 1) ×
  everyDays` and lasts `durationMin`. Its questions are drawn
  deterministically from the slots (seeded by *n*) and may include Pro items,
  which an open contest entry unlocks for free learners. Questions are hidden
  until the start. Live entries are ranked on the contest's own clock: points
  by difficulty (3/4/5/6), then penalty = minutes from the start to each solve
  + 5 per failed submit before it. Joining after the end is a virtual,
  unranked run with the same length. Once anyone joins, the contest's questions
  are read from their entry, so later content changes don't rewrite history.
- **Profiles** — `profiles`: handle (unique, `^[a-z0-9_]{3,20}$`, some
  reserved), display name, bio and a `public` flag (default off). Public pages
  (`/u/<handle>`) show solved counts per track, XP, streaks, 12 weeks of
  activity, recent solves, contest ranks and mock count — never email or code.
  Leaderboards show the display name and handle of public profiles and
  "First L." for everyone else.

Both config files are validated against the catalog at startup: every mock
slot needs at least twice its `count` in free items, every contest slot twice
its `count` in auto-graded items. `npx tsx scripts/pools.ts` (in
`apps/arena-service`) prints the pool sizes.

| Route (`/api/v1/arena`) | |
| --- | --- |
| `GET /mocks`, `POST /mocks {templateId}` | templates, open session, history, weekly allowance; start a mock |
| `GET /sessions/:id`, `POST /sessions/:id/finish` | a session (with the report once over); end it early |
| `GET /contests`, `GET /contests/:id`, `POST /contests/:id/join` | recent and next contests; details, questions, leaderboard (top 100 + your row); join live or virtually |
| `GET /me/profile`, `POST /me/profile` | your settings (suggested until saved); save them |
| `GET /profiles/:handle` | a public profile (404 when private or missing; no sign-in needed) |

Web: `/practice/mock`, `/practice/session/[id]`, `/practice/contests`,
`/practice/contests/[id]`, `/practice/profile`, `/u/[handle]`.

## Notes

- Maths renders with KaTeX through `rehype-katex`. `npm audit` flags KaTeX
  0.16 (GHSA-238p-pmpm-9mq7); the issue needs KaTeX's `trust` option, which is
  off, and only our own content is rendered as maths. Revisit when
  `rehype-katex` supports KaTeX 0.19.
