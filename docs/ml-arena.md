# ML Arena

Practice for the maths, Python/NumPy and machine learning behind real models:
short lessons, then items learners solve by calculating, predicting output and
writing code that's judged against hidden tests. Web routes live under
`/arena`; the backend is `apps/arena-service` (port 3009, database
`logixai-arena`).

## How it fits together

```
web /arena ──► arena-service ──SubmissionQueue──► evaluator-service ──► Docker sandbox
                    ▲                                   │              (logixai/python-ml:1)
                    └──────── ArenaEvaluationQueue ◄────┘
identity-service ── JWKS ──► arena-service (verifies access tokens)
```

- **Content** (tracks, topics, lessons, items, answers, reference solutions)
  lives in `apps/arena-service/content/` as YAML, reviewed in git, and is
  loaded into memory when the service starts. The service refuses to start if
  the content is invalid or its generated tests are out of date.
- **Progress** (per-item status, code submissions, XP and active days) is in
  MongoDB: collections `item_progress`, `submissions`, `user_stats`.
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
   NumPy arrays, calls the function and prints only the return value as JSON.
3. The evaluator compares that JSON with the expected value **outside** the
   sandbox, with a tolerance for floats (`checker: json`). Expected outputs
   never enter the sandbox, so the only way to pass is to compute the answer.
4. For hidden tests the learner sees only the verdict, never error text, since
   code could print the hidden inputs to stderr and raise.

Sandbox limits are the judge's usual ones (no network, no capabilities,
read-only filesystem, `nobody` user), with 512 MB of memory and a per-test time
limit of 6 s (2 s × 3 for Python). A learner can have one run in the judge at a
time and 12 runs per minute (`CODE_RUNS_PER_MINUTE`).

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
- runs every `output` snippet and checks the answer is exactly what it prints.

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

Planned for later phases (see the roadmap): the skill graph and
recommendations, spaced repetition, Pandas and dataset challenges, more labs,
arena items in institution exams and batch reports, Pro/Premium plans and
payments, PyTorch, and AI features (hints, interviewer).

The `access: pro` flag is stored on items and shown in the UI, but isn't
enforced until plans exist.

## Notes

- Maths renders with KaTeX through `rehype-katex`. `npm audit` flags KaTeX
  0.16 (GHSA-238p-pmpm-9mq7); the issue needs KaTeX's `trust` option, which is
  off, and only our own content is rendered as maths. Revisit when
  `rehype-katex` supports KaTeX 0.19.
