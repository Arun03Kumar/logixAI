import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { UnauthorizedError, type AccessTokenVerifier } from "@logixai/service-kit";
import { buildApp } from "../src/app.js";
import { loadCatalog, readSources, type Catalog } from "../src/content/catalog.js";
import { buildJudgeProgram, buildSqlJudgeProgram } from "../src/content/harness.js";
import { TopicFileSchema } from "../src/content/schema.js";
import type { ArenaService, JudgeRequest } from "../src/services/arenaService.js";
import { createMemoryStore } from "../src/store/memoryStore.js";

/* P1: SQL items, table previews for data problems, the problem list and curated lists. */

const CONTENT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "content");
const catalog: Catalog = loadCatalog(CONTENT);

const verifier: AccessTokenVerifier = {
  async verify(token) {
    const pro = token.startsWith("pro-");
    return { sub: token, role: "user", name: token, email: `${token}@x.com`, plan: pro ? "pro" : "free", planUntil: pro ? 4_102_444_800 : null };
  },
  async verifyHeader(header) {
    const token = String(header ?? "").replace(/^Bearer /, "");
    if (!token) throw new UnauthorizedError();
    return this.verify(token);
  },
};

let app: FastifyInstance;
let arena: ArenaService;
let judged: JudgeRequest[];

beforeEach(async () => {
  judged = [];
  const built = await buildApp({
    catalog,
    store: createMemoryStore(),
    judge: { submit: async (r) => void judged.push(r) },
    identity: { getMembership: async () => null, myMemberships: async () => [], listBatches: async () => [], listBatchMembers: async () => [] },
    verifier,
    corsOrigins: [],
    codeRunsPerMinute: 1000,
    now: () => new Date("2026-11-20T06:00:00Z"),
  });
  app = built.app;
  arena = built.arena;
});

async function req(user: string | null, method: string, url: string, payload?: unknown) {
  const res = await app.inject({
    method: method as never,
    url: `/api/v1/arena${url}`,
    headers: user ? { authorization: `Bearer ${user}` } : {},
    payload: payload as never,
  });
  return { status: res.statusCode, data: res.json().data };
}

describe("SQL items", () => {
  it("show the schema and sample tables, never the solution or hidden data", async () => {
    const item = (await req("asha", "GET", "/items/sql-customers-without-orders")).data;
    expect(item.type).toBe("sql");
    expect(item.sqlTables.map((t: { name: string }) => t.name)).toEqual(["customers", "orders", "products", "order_items"]);
    expect(item.sqlTables[0].columns[0]).toEqual(["id", "INTEGER"]);
    expect(item.ordered).toBe(false);
    expect(item.samples).toHaveLength(1);
    expect(item.samples[0].call).toBe("Sample data 1");
    const customers = item.samples[0].tables.find((t: { name: string }) => t.name === "customers");
    expect(customers.columns).toEqual(["id", "name", "city", "signup_date"]);
    expect(customers.rows[0]).toEqual([1, "Asha", "Mumbai", "2024-01-05"]);
    expect(JSON.parse(item.samples[0].expected)).toEqual({ columns: ["id", "name"], data: [[5, "Arjun"]] });
    expect(item.hiddenTestCount).toBe(2);
    expect(item).not.toHaveProperty("solution");
    expect(JSON.stringify(item)).not.toContain("o.id IS NULL");
    // Hidden datasets (e.g. the edge case with a customer without a city) stay on the server.
    expect(JSON.stringify(item)).not.toContain("Lata");
  });

  it("are judged with the SQL harness and a JSON checker", async () => {
    const item = catalog.item("sql-customers-without-orders")!;
    const query = "SELECT id, name FROM customers WHERE id = 5";
    const run = await req("asha", "POST", "/items/sql-customers-without-orders/code", { code: query, mode: "run" });
    expect(run.status).toBe(202);
    expect(judged[0]!.program).toContain("duckdb");
    expect(judged[0]!.program).toContain(Buffer.from(query).toString("base64"));
    expect(judged[0]!.program).not.toContain("solution.py");
    expect(judged[0]!.checker).toEqual({ kind: "json", absTol: 1e-6, relTol: 1e-6 });
    // Each test's input is the dataset; the expected rows never enter the program.
    const input = JSON.parse(judged[0]!.tests[0]!.input);
    expect(Object.keys(input.args[0])).toEqual(["customers", "orders", "products", "order_items"]);
    expect(judged[0]!.program).not.toContain(Buffer.from(judged[0]!.tests[0]!.output).toString("base64"));

    await arena.applyJudgeResult({
      submissionId: run.data.id,
      userId: "asha",
      response: [{ status: "WA", output: '{"columns":["id","name"],"data":[]}', timeMs: 30 }],
    });
    const result = (await req("asha", "GET", `/submissions/${run.data.id}`)).data;
    expect(result.tests[0]).toMatchObject({ call: "Sample data 1", verdict: "WA" });

    const total = item.judge!.sample.length + item.judge!.hidden.length;
    const submit = await req("asha", "POST", "/items/sql-customers-without-orders/code", { code: query, mode: "submit" });
    await arena.applyJudgeResult({
      submissionId: submit.data.id,
      userId: "asha",
      response: Array.from({ length: total }, () => ({ status: "SUCCESS" as const, output: "{}", timeMs: 5 })),
    });
    const view = (await req("asha", "GET", "/items/sql-customers-without-orders")).data;
    expect(view.status).toBe("solved");
    expect(view.solution).toContain("LEFT JOIN");
  });

  it("every SQL item has built tests, hidden datasets and a starter that differs", () => {
    const sql = catalog.items.filter((i) => i.type === "sql");
    expect(sql.length).toBeGreaterThanOrEqual(45);
    for (const item of sql) {
      expect(item.judge?.sample.length, item.id).toBeGreaterThan(0);
      expect(item.judge?.hidden.length, item.id).toBeGreaterThan(0);
    }
  });

  it("builds a program that sorts rows unless order matters", () => {
    const tables = [{ name: "t", columns: [["x", "INTEGER"]] as [string, string][] }];
    expect(buildSqlJudgeProgram({ tables, ordered: false }, "SELECT 1")).toContain("__lx_ordered = False");
    expect(buildSqlJudgeProgram({ tables, ordered: true }, "SELECT 1")).toContain("__lx_ordered = True");
  });
});

describe("content format", () => {
  const base = { id: "t", title: "T", summary: "S", lesson: "L" };
  const sqlItem = { id: "q", type: "sql", title: "Q", difficulty: "easy", prompt: "p", explanation: "e", database: "db", starter: "SELECT 1", solution: "SELECT 2" };
  const db = { tables: [{ name: "t", columns: [["x", "INTEGER"], ["y", "VARCHAR"]] }], datasets: { a: { t: [[1, "a"]] }, b: { t: [] } } };

  it("copies a database's tables and datasets into SQL items", () => {
    const topic = TopicFileSchema.parse({ ...base, databases: { db }, items: [{ ...sqlItem, tests: { sample: ["a"], hidden: ["b"] } }] });
    const item = topic.items[0]!;
    if (item.type !== "sql") throw new Error("expected sql");
    expect(item.tables[0]!.name).toBe("t");
    expect(item.tests.sample[0]!.args[0]).toEqual({ t: [[1, "a"]] });
    expect(item.tests.hidden[0]!.args[0]).toEqual({ t: [] });
  });

  it("rejects unknown databases, datasets, tables and wrong row lengths", () => {
    const bad = (topic: unknown) => TopicFileSchema.safeParse(topic).success;
    expect(bad({ ...base, databases: { db }, items: [{ ...sqlItem, database: "nope", tests: { sample: ["a"] } }] })).toBe(false);
    expect(bad({ ...base, databases: { db }, items: [{ ...sqlItem, tests: { sample: ["zzz"] } }] })).toBe(false);
    const wrongRow = { ...db, datasets: { a: { t: [[1]] } } };
    expect(bad({ ...base, databases: { db: wrongRow }, items: [{ ...sqlItem, tests: { sample: ["a"] } }] })).toBe(false);
    const wrongTable = { ...db, datasets: { a: { other: [] } } };
    expect(bad({ ...base, databases: { db: wrongTable }, items: [{ ...sqlItem, tests: { sample: ["a"] } }] })).toBe(false);
    expect(bad({ ...base, databases: { db }, items: [{ ...sqlItem, tests: { sample: ["a"] } }] })).toBe(true);
  });

  it("expands {$frame} test arguments", () => {
    const code = {
      id: "c", type: "code", title: "C", difficulty: "easy", prompt: "p", explanation: "e",
      function: { name: "f", params: [{ name: "df", type: "dataframe" }], returns: "int" },
      starter: "def f(df): return 0", solution: "def f(df): return len(df)",
      tests: { sample: [{ args: [{ $frame: "people" }] }] },
    };
    const frames = { people: { columns: ["a"], data: [[1], [2]] } };
    const topic = TopicFileSchema.parse({ ...base, frames, items: [code] });
    const item = topic.items[0]!;
    if (item.type !== "code") throw new Error("expected code");
    expect(item.tests.sample[0]!.args[0]).toEqual(frames.people);
    expect(TopicFileSchema.safeParse({ ...base, items: [code] }).success).toBe(false);
  });
});

describe("PyTorch items", () => {
  it("show the test driver for class-based items and send it to the judge", async () => {
    const item = (await req("asha", "GET", "/items/nn-layernorm")).data;
    expect(item.driver).toContain("norm = LayerNorm(x.shape[-1])");
    expect(item.signature.params.map((p: { type: string }) => p.type)).toEqual(["tensor", "tensor", "tensor"]);
    expect(item).not.toHaveProperty("solution");

    const code = "import torch\nclass LayerNorm(torch.nn.Module):\n    pass\n";
    const run = await req("asha", "POST", "/items/nn-layernorm/code", { code, mode: "run" });
    expect(run.status).toBe(202);
    const program = judged[0]!.program;
    expect(program).toContain(Buffer.from(code).toString("base64"));
    const { driver } = catalog.item("nn-layernorm") as { driver?: string };
    expect(program).toContain(Buffer.from(driver!).toString("base64"));
    expect(judged[0]!.checker).toEqual({ kind: "json", absTol: 1e-4, relTol: 1e-4 });
  });

  it("items without a driver build the plain program", () => {
    const fn = { name: "f", params: [{ name: "x", type: "tensor" }] };
    const driver = Buffer.from("def g(): pass").toString("base64");
    expect(buildJudgeProgram(fn, "def f(x): return x")).not.toContain(driver);
    expect(buildJudgeProgram(fn, "def f(x): return x", "def g(): pass")).toContain(driver);
  });

  it("every PyTorch code item has built tests and a starter that differs", () => {
    const items = catalog.tracks.find((t) => t.id === "pytorch-interview")!.topics.flatMap((t) => t.items);
    const judgedItems = items.filter((i) => i.type === "code" || i.type === "debug");
    expect(judgedItems.length).toBe(27);
    for (const i of judgedItems) expect(i.judge?.sample.length, i.id).toBeGreaterThan(0);
  });
});

describe("JavaScript and React items", () => {
  it("show the language, the driver and the live preview", async () => {
    const item = (await req("asha", "GET", "/items/react-bounded-counter")).data;
    expect(item).toMatchObject({ language: "javascript", preview: { component: "Counter", props: { start: 1, min: 0, max: 3 } } });
    expect(item.driver).toContain("__lx.render(<Counter");
    expect(item.samples[0].call).toBe('check({"start":1,"min":0,"max":3}, ["+","+","+","+"])');
    expect(JSON.stringify(item)).not.toContain("Math.min(max");
    const out = (await req("asha", "GET", "/items/js-event-loop-order")).data;
    expect(out.language).toBe("javascript");
    const py = (await req("asha", "GET", "/items/np-log-softmax")).data;
    expect(py.language).toBe("python");
  });

  it("are judged in the Node runtime with the JS harness", async () => {
    const code = "function debounce(fn, wait) { return fn; }";
    const run = await req("asha", "POST", "/items/js-debounce/code", { code, mode: "run" });
    expect(run.status).toBe(202);
    expect(judged[0]!.language).toBe("NODE_WEB");
    expect(judged[0]!.program).toContain('require("vm")');
    expect(judged[0]!.program).toContain(Buffer.from(code).toString("base64"));
    expect(judged[0]!.checker).toEqual({ kind: "json", absTol: 1e-6, relTol: 1e-6 });

    await req("ravi", "POST", "/items/np-log-softmax/code", { code: "def log_softmax(Z): return Z", mode: "run" });
    expect(judged[1]!.language).toBe("PYTHON_ML");
  });

  it("reject Python-only features and drivers without expose", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "arena-js-"));
    try {
      mkdirSync(path.join(dir, "t"));
      writeFileSync(path.join(dir, "t", "track.yaml"), "id: t\ntitle: T\nsummary: S\nlevel: interview\narea: frontend\norder: 1\ntopics: [js]\n");
      const item = (id: string, extra: string) =>
        `  - id: ${id}\n    type: code\n    language: javascript\n    title: X\n    difficulty: easy\n    prompt: p\n    explanation: e\n` +
        `    starter: "function f(a) {}"\n    solution: "function f(a) { return 1; }"\n    tests: { sample: [{ args: [[1]] }] }\n${extra}`;
      writeFileSync(
        path.join(dir, "t", "js.yaml"),
        "id: js\ntitle: J\nsummary: S\nlesson: L\nitems:\n" +
          item("arrays", "    function: { name: f, params: [{ name: a, type: ndarray }], returns: x }\n") +
          item("no-expose", "    driver: \"function check(a) { return f(a); }\"\n    function: { name: check, params: [{ name: a, type: list }], returns: x }\n"),
      );
      expect(() => readSources(dir)).toThrow(/ndarray params are Python only[\s\S]*driver needs expose/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("system design", () => {
  const essay = "I would put a token bucket per API key in Redis, updated atomically with a Lua script. ".repeat(4);

  it("charts simulation output", async () => {
    const item = (await req("asha", "GET", "/items/sd-token-bucket")).data;
    expect(item.visual).toEqual({ kind: "timeline", field: "decisions", title: "Requests (green allowed, red rejected)" });
    expect(item.language).toBe("javascript");
  });

  it("design items show the rubric only after a written attempt, then solve by self-check", async () => {
    const fresh = (await req("asha", "GET", "/items/sd-design-rate-limiter")).data;
    expect(fresh.type).toBe("design");
    expect(fresh.passShare).toBe(0.7);
    expect(fresh).not.toHaveProperty("rubric");
    expect(fresh).not.toHaveProperty("modelAnswer");

    const short = await req("asha", "POST", "/items/sd-design-rate-limiter/answer", { text: "token bucket" });
    expect(short.status).toBe(400);

    const draft = (await req("asha", "POST", "/items/sd-design-rate-limiter/answer", { text: essay })).data;
    expect(draft).toMatchObject({ correct: false, status: "attempted", xpGained: 0 });
    expect(draft.rubric).toHaveLength(10);
    expect(draft.modelAnswer).toContain("token bucket");

    const after = (await req("asha", "GET", "/items/sd-design-rate-limiter")).data;
    expect(after.rubric[0]).toMatchObject({ id: "requirements" });
    expect(after.lastAnswer).toEqual({ text: essay });

    const ids: string[] = draft.rubric.map((r: { id: string }) => r.id);
    const tooFew = (await req("asha", "POST", "/items/sd-design-rate-limiter/answer", { text: essay, checked: ids.slice(0, 6) })).data;
    expect(tooFew).toMatchObject({ correct: false, status: "attempted" });
    // Unknown ids don't count towards the 70%.
    const padded = (await req("asha", "POST", "/items/sd-design-rate-limiter/answer", { text: essay, checked: [...ids.slice(0, 6), "made-up"] })).data;
    expect(padded.correct).toBe(false);

    const enough = (await req("asha", "POST", "/items/sd-design-rate-limiter/answer", { text: essay, checked: ids.slice(0, 7) })).data;
    expect(enough).toMatchObject({ correct: true, status: "solved", xpGained: 40 });
    expect(enough.explanation).toBeTruthy();
  });
});

describe("data problems", () => {
  it("show DataFrame arguments as tables", async () => {
    const item = (await req("asha", "GET", "/items/pd-order-segments")).data;
    expect(item.samples[0].tables.map((t: { name: string }) => t.name)).toEqual(["orders", "customers"]);
    expect(item.samples[0].tables[0].columns).toContain("order_id");
    // Plain arguments have no tables.
    const plain = (await req("asha", "GET", "/items/vec-dot-code")).data;
    expect(plain.samples[0]).not.toHaveProperty("tables");
  });
});

describe("problem list and curated lists", () => {
  it("filters by type, difficulty, track, tag, list and search", async () => {
    const all = (await req(null, "GET", "/problems")).data;
    expect(all.total).toBe(catalog.items.length);
    expect(all.items[0]).toMatchObject({ topic: { id: expect.any(String) }, track: { id: expect.any(String) } });
    expect(all.tags[0].count).toBeGreaterThan(10);

    const sql = (await req(null, "GET", "/problems?type=sql")).data;
    expect(sql.items.every((i: { type: string }) => i.type === "sql")).toBe(true);
    const hardSql = (await req(null, "GET", "/problems?type=sql&difficulty=hard")).data;
    expect(hardSql.total).toBeGreaterThan(0);
    expect(hardSql.total).toBeLessThan(sql.total);

    const track = (await req(null, "GET", "/problems?track=pandas-interview")).data;
    expect(track.total).toBe(30);
    const tag = (await req(null, "GET", "/problems?tag=window")).data;
    expect(tag.items.every((i: { tags: string[] }) => i.tags.includes("window"))).toBe(true);
    // Case-insensitive search over titles and tags.
    expect((await req(null, "GET", "/problems?q=SECOND-highest")).data.items.map((i: { id: string }) => i.id)).toEqual([
      "sql-second-highest-salary",
    ]);
    expect((await req(null, "GET", "/problems?q=gaps-and-islands")).data.items.map((i: { id: string }) => i.id)).toEqual([
      "sql-three-day-streak",
    ]);
    expect((await req(null, "GET", "/problems?q=zzzz")).data.total).toBe(0);

    const list = (await req(null, "GET", "/problems?list=ml-coding-round")).data;
    expect(list.items[0].id).toBe("np-log-softmax");
    expect((await req(null, "GET", "/problems?list=nope")).status).toBe(404);
    expect((await req(null, "GET", "/problems?difficulty=impossible")).status).toBe(400);
  });

  it("tracks the learner's status in lists and filters", async () => {
    await req("asha", "POST", "/items/sql-null-not-equal-mcq/answer", { selectedOptionIds: ["b"] });
    await req("asha", "POST", "/items/sql-count-null-mcq/answer", { selectedOptionIds: ["b"] });
    const solved = (await req("asha", "GET", "/problems?status=solved")).data;
    expect(solved.items.map((i: { id: string }) => i.id)).toEqual(["sql-null-not-equal-mcq"]);
    const attempted = (await req("asha", "GET", "/problems?status=attempted")).data;
    expect(attempted.items.map((i: { id: string }) => i.id)).toEqual(["sql-count-null-mcq"]);
    const todo = (await req("asha", "GET", "/problems?status=todo&type=mcq_single&track=sql-interview")).data;
    expect(todo.items.map((i: { id: string }) => i.id)).not.toContain("sql-null-not-equal-mcq");

    const lists = (await req("asha", "GET", "/lists")).data;
    expect(lists.map((l: { id: string }) => l.id)).toEqual([
      "interview-essentials",
      "sql-interview-set",
      "pandas-30",
      "ml-coding-round",
      "pytorch-coding-round",
      "numpy-25",
      "frontend-coding-round",
      "system-design-runnable",
      "llm-agents-set",
    ]);
    const sqlSet = lists.find((l: { id: string }) => l.id === "sql-interview-set");
    expect(sqlSet).toMatchObject({ itemCount: 54, solvedCount: 1 });
  });
});
