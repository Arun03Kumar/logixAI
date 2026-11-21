/**
 * Authoring format for ML Arena content (content/<track>/track.yaml and
 * content/<track>/<topic>.yaml). Everything here, including answers and
 * reference solutions, stays on the server.
 */
import { ACCESS_LEVELS, ARENA_DIFFICULTIES, METRICS, TRACK_LEVELS } from "@logixai/contracts";
import { z } from "@logixai/service-kit";

const Slug = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "lowercase-words-with-dashes");
/** SQL table/column names and dataset names: plain identifiers. */
const Ident = z.string().regex(/^[a-z_][a-z0-9_]*$/, "lowercase_identifier");
const Markdown = z.string().trim().min(1);

export const TrackFileSchema = z.object({
  id: Slug,
  title: z.string().min(1),
  summary: z.string().min(1),
  level: z.enum(TRACK_LEVELS),
  order: z.number().int(),
  /** Topic ids in learning order; each has a <id>.yaml next to this file. */
  topics: z.array(Slug).min(1),
});
export type TrackFile = z.infer<typeof TrackFileSchema>;

const Base = {
  id: Slug,
  title: z.string().min(1).max(120),
  difficulty: z.enum(ARENA_DIFFICULTIES),
  access: z.enum(ACCESS_LEVELS).default("free"),
  tags: z.array(z.string()).default([]),
  prompt: Markdown,
  hints: z.array(Markdown).default([]),
  /** Why the answer is right; shown after solving or revealing. */
  explanation: Markdown,
};

const Option = z.object({ id: z.string().regex(/^[a-z]$/), text: z.string().min(1) });

/** Positional arguments for one call, as JSON values. */
const Args = z.array(z.unknown());
const TestCase = z.object({
  args: Args,
  /** Optional: when given, the build checks the reference solution returns it. */
  expected: z.unknown().optional(),
});

/**
 * Parameter types. `ndarray` / `ndarray_int` arguments arrive as NumPy arrays
 * (float64 / int64), `tensor` / `tensor_int` as PyTorch tensors (float32 /
 * int64), `dataframe` as a pandas DataFrame (written in tests as
 * {"columns": [...], "data": [[...], ...]}, null for missing values);
 * everything else as plain Python values.
 */
export const PARAM_TYPES = ["float", "int", "bool", "str", "list", "dict", "ndarray", "ndarray_int", "tensor", "tensor_int", "dataframe"] as const;

/** Languages for code items: Python (PYTHON_ML) or JavaScript / React (NODE_WEB). */
export const CODE_LANGUAGES = ["python", "javascript"] as const;

const CodeFields = {
  /** python (default) or javascript (JSX allowed; judged in Node with React and jsdom). */
  language: z.enum(CODE_LANGUAGES).default("python"),
  /**
   * javascript items: names the driver (or the call) needs from the learner's
   * code — functions, classes or components. Defaults to [function.name].
   */
  expose: z.array(z.string().regex(/^[A-Za-z_$][A-Za-z0-9_$]*$/)).optional(),
  /**
   * javascript items: render the learner's component live in the browser.
   * `component` is one of the exposed names; `props` are passed to it.
   */
  preview: z.object({ component: z.string(), props: z.record(z.string(), z.unknown()).default({}) }).optional(),
  /**
   * Chart each test's output in the web player (system-design simulations):
   * timeline = [time, allowed] or [time, key, allowed] rows, bars = { label: number }.
   * `field` picks a property of the output.
   */
  visual: z.object({ kind: z.enum(["timeline", "bars"]), field: z.string().optional(), title: z.string().optional() }).optional(),
  function: z.object({
    name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/),
    params: z.array(z.object({ name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/), type: z.enum(PARAM_TYPES) })).min(1),
    returns: z.string().min(1),
  }),
  /**
   * Optional test driver: Python run after the student's code, in the same
   * namespace, that defines `function.name`. Lets an item ask for a class
   * (an nn.Module, a training loop) and test it through a function. Shown to
   * the learner as "how your code is tested", so it must not contain answers.
   */
  driver: z.string().min(1).optional(),
  /** What the student starts with (for debug items: the broken code). */
  starter: z.string().min(1),
  /** Reference solution. Must pass every test; the starter must fail at least one. */
  solution: z.string().min(1),
  tests: z.object({
    /** At least one, unless the item uses a dataset (then tests come from its split). */
    sample: z.array(TestCase).default([]),
    hidden: z.array(TestCase).default([]),
    /**
     * Python defining `cases(rng)` -> list of argument lists, for extra hidden
     * tests. `rng` is numpy.random.default_rng(<item seed>), so it's repeatable;
     * NumPy is available as `np`.
     */
    generate: z.string().optional(),
  }).default({ sample: [], hidden: [] }),
  /**
   * Dataset challenge: the function is called as f(train, test) with two
   * DataFrames and must return one prediction per test row. Rows are split
   * deterministically: Run uses a validation split of the training rows, Submit
   * trains on all training rows and predicts the held-out test rows.
   */
  dataset: z
    .object({
      /** content/datasets/<file> */
      file: z.string().regex(/^[a-z0-9-]+.csv$/),
      target: z.string().min(1),
      testFraction: z.number().gt(0).lt(0.6).default(0.25),
      validFraction: z.number().gt(0).lt(0.6).default(0.2),
      seed: z.number().int().default(1),
    })
    .optional(),
  /** With a dataset: how predictions are scored, and the score needed to pass. */
  scoring: z.object({ metric: z.enum(METRICS), threshold: z.number() }).optional(),
  tolerance: z.object({ abs: z.number().nonnegative(), rel: z.number().nonnegative() }).default({ abs: 1e-6, rel: 1e-6 }),
};

/**
 * Column types for SQL practice databases (DuckDB). Values in datasets are
 * JSON: numbers, strings (dates as "2024-01-31", timestamps as
 * "2024-01-31 09:30:00"), booleans and null.
 */
export const SqlTypeSchema = z
  .string()
  .regex(/^(INTEGER|BIGINT|DOUBLE|VARCHAR|DATE|TIMESTAMP|BOOLEAN|DECIMAL\(\d{1,2},\d{1,2}\))$/, "a DuckDB type like INTEGER, VARCHAR, DATE or DECIMAL(10,2)");

const SqlTableSchema = z.object({
  name: Ident,
  /** [name, type] pairs, in order. */
  columns: z.array(z.tuple([Ident, SqlTypeSchema])).min(1),
});

/**
 * A practice database: its tables, and named datasets (rows per table).
 * Items reference a database and pick datasets as sample / hidden tests.
 */
const SqlDatabaseSchema = z.object({
  description: z.string().default(""),
  tables: z.array(SqlTableSchema).min(1),
  datasets: z.record(Ident, z.record(Ident, z.array(z.array(z.unknown())))),
});

/** A SQL query, judged by running it on each dataset and comparing the rows it returns. */
const SqlItemFields = {
  database: Ident,
  starter: z.string().min(1),
  solution: z.string().min(1),
  /** true: rows must come back in the reference's order (the question asks for ORDER BY). */
  ordered: z.boolean().default(false),
  tests: z.object({ sample: z.array(Ident).min(1), hidden: z.array(Ident).default([]) }),
  tolerance: z.object({ abs: z.number().nonnegative(), rel: z.number().nonnegative() }).default({ abs: 1e-6, rel: 1e-6 }),
};

const AuthoredItemSchema = z.discriminatedUnion("type", [
  z.object({ ...Base, type: z.literal("mcq_single"), options: z.array(Option).min(2).max(8), answer: z.string() }),
  z.object({ ...Base, type: z.literal("mcq_multi"), options: z.array(Option).min(2).max(8), answer: z.array(z.string()).min(1) }),
  z.object({
    ...Base,
    type: z.literal("numeric"),
    answer: z.number(),
    /** Accepted absolute difference. */
    tolerance: z.number().nonnegative().default(0.01),
    answerFormat: z.string().optional(),
  }),
  z.object({
    ...Base,
    type: z.literal("output"),
    /** Python (or, with language: javascript, Node) snippet; the build runs it and checks `answer` is what it prints. */
    snippet: z.string().min(1),
    language: z.enum(CODE_LANGUAGES).default("python"),
    answer: z.string(),
  }),
  z.object({ ...Base, type: z.literal("code"), ...CodeFields }),
  z.object({ ...Base, type: z.literal("debug"), ...CodeFields }),
  z.object({ ...Base, type: z.literal("sql"), ...SqlItemFields }),
  z.object({
    ...Base,
    type: z.literal("design"),
    /**
     * What a strong answer covers. Learners see it only after writing their
     * own design, then tick the points they covered.
     */
    rubric: z.array(z.object({ id: Slug, point: z.string().min(1), detail: z.string().optional() })).min(3).max(30),
    /** A worked answer, shown with the rubric. */
    modelAnswer: Markdown,
    /** Share of rubric points to tick for the item to count as solved. */
    passShare: z.number().gt(0).lte(1).default(0.7),
  }),
]);
type AuthoredItem = z.infer<typeof AuthoredItemSchema>;

export type SqlTable = z.infer<typeof SqlTableSchema>;
/** One SQL test: rows for each table. */
export type SqlDataset = Record<string, unknown[][]>;

/** A SQL item after loading: its tables and datasets are copied in from the topic's database. */
export type SqlItemSource = Omit<Extract<AuthoredItem, { type: "sql" }>, "tests"> & {
  tables: SqlTable[];
  tests: { sample: { args: [SqlDataset] }[]; hidden: { args: [SqlDataset] }[] };
};
export type ItemSource = Exclude<AuthoredItem, { type: "sql" }> | SqlItemSource;
export type CodeItemSource = Extract<ItemSource, { type: "code" | "debug" }>;
/** Items judged by running code: functions (code, debug) and queries (sql). */
export type JudgedItemSource = CodeItemSource | SqlItemSource;

/** A DataFrame written once in a topic and used in tests as {"$frame": "name"}. */
const FrameSchema = z.object({ columns: z.array(z.string()).min(1), data: z.array(z.array(z.unknown())) });

const isFrameRef = (v: unknown): v is { $frame: string } =>
  typeof v === "object" && v !== null && !Array.isArray(v) && Object.keys(v).length === 1 && typeof (v as { $frame?: unknown }).$frame === "string";

export const TopicFileSchema = z
  .object({
    id: Slug,
    title: z.string().min(1),
    summary: z.string().min(1),
    /** Topic ids (any track) worth knowing first. */
    prerequisites: z.array(Slug).default([]),
    lesson: Markdown,
    /** SQL databases used by this topic's sql items. */
    databases: z.record(Ident, SqlDatabaseSchema).default({}),
    /** DataFrames reused across this topic's tests. */
    frames: z.record(Ident, FrameSchema).default({}),
    items: z.array(AuthoredItemSchema).min(1),
  })
  .transform((topic, ctx) => {
    const { databases, frames, ...rest } = topic;
    const fail = (message: string) => {
      ctx.addIssue({ code: "custom", message });
      return z.NEVER;
    };
    for (const [name, db] of Object.entries(databases)) {
      const tables = new Set(db.tables.map((t) => t.name));
      for (const [ds, rows] of Object.entries(db.datasets)) {
        for (const [table, data] of Object.entries(rows)) {
          const def = db.tables.find((t) => t.name === table);
          if (!def) return fail(`database ${name}, dataset ${ds}: unknown table ${table}`);
          const bad = data.findIndex((r) => r.length !== def.columns.length);
          if (bad >= 0) return fail(`database ${name}, dataset ${ds}, table ${table}: row ${bad + 1} has ${data[bad]!.length} values, expected ${def.columns.length}`);
        }
        for (const t of tables) if (!(t in rows)) rows[t] = [];
      }
    }
    const frame = (v: unknown, where: string) => {
      if (!isFrameRef(v)) return v;
      const f = frames[v.$frame];
      if (!f) return fail(`${where}: unknown frame ${v.$frame}`);
      return structuredClone(f);
    };
    const items = rest.items.map((item): ItemSource => {
      if (item.type === "sql") {
        const db = databases[item.database];
        if (!db) return fail(`${item.id}: unknown database ${item.database}`);
        const pick = (name: string) => {
          const rows = db.datasets[name];
          if (!rows) return fail(`${item.id}: database ${item.database} has no dataset ${name}`);
          return { args: [structuredClone(rows)] as [SqlDataset] };
        };
        return { ...item, tables: db.tables, tests: { sample: item.tests.sample.map(pick), hidden: item.tests.hidden.map(pick) } };
      }
      if (item.type === "code" || item.type === "debug") {
        const resolve = (t: { args: unknown[]; expected?: unknown }) => ({ ...t, args: t.args.map((a) => frame(a, item.id)) });
        return { ...item, tests: { ...item.tests, sample: item.tests.sample.map(resolve), hidden: item.tests.hidden.map(resolve) } };
      }
      return item;
    });
    return { ...rest, items };
  });
export type TopicFile = z.output<typeof TopicFileSchema>;

/** content/lists.yaml: curated problem lists ("SQL 50", ...), in display order. */
export const ListsFileSchema = z.array(
  z.object({
    id: Slug,
    title: z.string().min(1),
    summary: z.string().min(1),
    items: z.array(Slug).min(1),
  }),
);
export type ListsFile = z.infer<typeof ListsFileSchema>;

/** content/tests.generated.json: expected outputs computed by `npm run content:build`. */
export const GeneratedTestsSchema = z.object({
  items: z.record(
    z.string(),
    z.object({
      /** Hash of the item's function, solution and tests when this was built. */
      hash: z.string(),
      sample: z.array(z.object({ args: Args, expected: z.string() })),
      hidden: z.array(z.object({ args: Args, expected: z.string() })),
    }),
  ),
});
export type GeneratedTests = z.infer<typeof GeneratedTestsSchema>;
