# ML Arena

Practice for the maths, Python/NumPy and machine learning behind real models:
short lessons, then items learners solve by calculating, predicting output and
writing code that's judged against hidden tests. Web routes live under
`/arena`; the backend is `apps/arena-service` (port 3010, database
`logixai-arena`).

## How it fits together

```
web /arena ──► arena-service ──SubmissionQueue──► evaluator-service ──► Docker sandbox
                    ▲                                   │              (logixai/python-ml:1)
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
  `user_stats`; institutions add `track_assignments` and `audit_events`.
- **Code items** go through the same evaluator as practice problems and exams,
  using the `PYTHON_ML` runtime (Python 3.12 with NumPy, Pandas, SciPy and
  scikit-learn; CPU only). Build its image once with `npm run judge:images`.

## Item types

| Type | Learner does | Graded |
| --- | --- | --- |
| `mcq_single`, `mcq_multi` | picks options | instantly, by the service |
| `numeric` | types a number | instantly, within `tolerance` |
| `output` | types what a snippet prints | instantly (trailing whitespace ignored) |
| `code` | implements a function | by the judge, sample + hidden tests |
| `debug` | fixes broken code | by the judge, like `code` |
| `code` + `dataset` | trains a model on a CSV, predicts held-out rows | by the judge: a metric (accuracy, f1, r2, rmse, mae) must reach a threshold |

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
   NumPy arrays and `dataframe` params to pandas DataFrames, calls the function
   and prints only the return value as JSON. A returned DataFrame is compared
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

## Adding or changing content

Each track is a folder with `track.yaml` (title, level, ordered topic ids) and
one `<topic>.yaml` per topic: lesson (Markdown with `$maths$`), prerequisites
and items. The schema with comments is `apps/arena-service/src/content/schema.ts`;
copy an existing item as a template.

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

## Not built yet

Planned for later phases: arena items inside institution exams, CSV export of
batch reports, PyTorch and deep-learning
content, SQL practice, contests and public profiles, and AI features (hints,
interviewer).

Items with `access: pro` are locked for users without Pro, and free users
have a daily cap on code runs; see [billing.md](billing.md).

## Notes

- Maths renders with KaTeX through `rehype-katex`. `npm audit` flags KaTeX
  0.16 (GHSA-238p-pmpm-9mq7); the issue needs KaTeX's `trust` option, which is
  off, and only our own content is rendered as maths. Revisit when
  `rehype-katex` supports KaTeX 0.19.
