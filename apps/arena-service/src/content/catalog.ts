import { applyBrowserRunRecord, readBrowserRunRecord } from "./browserRun.js";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { XP_BY_DIFFICULTY, type ArenaDifficulty, type Area } from "@logixai/contracts";
import { parse as parseYaml } from "yaml";
import {
  GeneratedTestsSchema,
  ListsFileSchema,
  TopicFileSchema,
  TrackFileSchema,
  type CodeItemSource,
  type GeneratedTests,
  type ItemSource,
  type JudgedItemSource,
  type ListsFile,
  type TopicFile,
  type TrackFile,
} from "./schema.js";
import { loadDataset, splitDataset, type DatasetSplit } from "./datasets.js";
import { loadCourses, type CourseConfig } from "./courseConfig.js";
import { loadPracticeConfig, type PracticeConfig } from "./practiceConfig.js";

export const GENERATED_FILE = "tests.generated.json";
export const LISTS_FILE = "lists.yaml";
/** SQL databases any topic can use (a map of name -> database). */
export const SHARED_DATABASES_FILE = "sql-databases.yaml";
/** DataFrames any topic's tests can use as {"$frame": name}. */
export const SHARED_FRAMES_FILE = "frames.yaml";

function readShared(dir: string, file: string): Record<string, unknown> {
  const p = path.join(dir, file);
  if (!existsSync(p)) return {};
  const value = parseYaml(readFileSync(p, "utf8")) as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${p}: expected a map of name -> definition`);
  return value as Record<string, unknown>;
}

export interface JudgeTest {
  args: unknown[];
  /** Expected return value, JSON-encoded by the harness. */
  expected: string;
}

export type CatalogItem = ItemSource & {
  topicId: string;
  trackId: string;
  /** The track's area. */
  area: Area;
  /** Position in the whole catalog (track order, topic order, item order). */
  order: number;
  weight: number;
  /** Code items only: tests with expected outputs from the content build. */
  judge?: { sample: JudgeTest[]; hidden: JudgeTest[] };
  /** Dataset challenges: the first rows and split sizes, for the item page. */
  datasetPreview?: DatasetSplit["preview"];
  /** Its browser Run was checked against the judge (content:browser-check); see browserRun.ts. */
  browserVerified?: boolean;
};

export interface CatalogTopic extends Omit<TopicFile, "items"> {
  trackId: string;
  area: Area;
  items: CatalogItem[];
}

export interface CatalogTrack extends Omit<TrackFile, "topics"> {
  topics: CatalogTopic[];
}

/** What a judged item's expected outputs depend on; a change means rebuild. */
export function codeItemHash(item: JudgedItemSource, datasetHash?: string): string {
  if (item.type === "sql") {
    const basis = JSON.stringify(["sql", item.tables, item.solution, item.tests, item.ordered, item.tolerance]);
    return createHash("sha256").update(basis).digest("hex").slice(0, 16);
  }
  const parts: unknown[] = [item.function, item.solution, item.tests, item.tolerance];
  if (item.driver) parts.push({ driver: item.driver });
  if (item.language === "javascript") parts.push({ language: item.language, expose: item.expose });
  if (item.dataset) parts.push(item.dataset, item.scoring, item.starter, datasetHash);
  const basis = JSON.stringify(parts);
  return createHash("sha256").update(basis).digest("hex").slice(0, 16);
}

export const isCode = (item: ItemSource): item is CodeItemSource =>
  item.type === "code" || item.type === "debug";

/** What the JavaScript harness needs from an item. */
export const jsHarnessFor = (item: CodeItemSource) => ({
  name: item.function.name,
  expose: item.expose ?? [item.function.name],
  ...(item.driver ? { driver: item.driver } : {}),
});

/** Items whose answer is code run by the judge: functions and SQL queries. */
export const isJudged = (item: ItemSource): item is JudgedItemSource => isCode(item) || item.type === "sql";

/** Reads and validates the YAML sources. Throws one error listing every problem. */
export interface ContentSources {
  tracks: TrackFile[];
  topics: Map<string, TopicFile>;
  lists: ListsFile;
}

export function readSources(dir: string): ContentSources {
  const problems: string[] = [];
  const tracks: TrackFile[] = [];
  const topics = new Map<string, TopicFile>();
  const shared = { databases: readShared(dir, SHARED_DATABASES_FILE), frames: readShared(dir, SHARED_FRAMES_FILE) };

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const trackDir = path.join(dir, entry.name);
    const trackPath = path.join(trackDir, "track.yaml");
    if (!existsSync(trackPath)) continue;
    const track = TrackFileSchema.safeParse(parseYaml(readFileSync(trackPath, "utf8")));
    if (!track.success) {
      problems.push(`${trackPath}: ${track.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
      continue;
    }
    tracks.push(track.data);
    for (const topicId of track.data.topics) {
      const topicPath = path.join(trackDir, `${topicId}.yaml`);
      if (!existsSync(topicPath)) {
        problems.push(`${trackPath}: topic file ${topicId}.yaml is missing`);
        continue;
      }
      const raw = parseYaml(readFileSync(topicPath, "utf8")) as Record<string, unknown> | null;
      // Shared databases and frames, unless the topic defines its own with the same name.
      if (raw && typeof raw === "object") {
        raw.databases = { ...structuredClone(shared.databases), ...((raw.databases as object) ?? {}) };
        raw.frames = { ...structuredClone(shared.frames), ...((raw.frames as object) ?? {}) };
      }
      const topic = TopicFileSchema.safeParse(raw);
      if (!topic.success) {
        problems.push(
          `${topicPath}: ${topic.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`,
        );
        continue;
      }
      if (topic.data.id !== topicId) problems.push(`${topicPath}: id must be "${topicId}"`);
      if (topics.has(topic.data.id)) problems.push(`${topicPath}: duplicate topic id ${topic.data.id}`);
      topics.set(topic.data.id, topic.data);
    }
  }

  const itemIds = new Set<string>();
  // item id -> its track's area, for checking lists.
  const topicArea = new Map(tracks.flatMap((t) => t.topics.map((id) => [id, t.area] as const)));
  const itemArea = new Map<string, string>();
  for (const topic of topics.values()) {
    for (const item of topic.items) itemArea.set(item.id, topicArea.get(topic.id) ?? "");
    for (const p of topic.prerequisites) {
      if (!topics.has(p)) problems.push(`topic ${topic.id}: unknown prerequisite ${p}`);
    }
    for (const item of topic.items) {
      const where = `${topic.id}/${item.id}`;
      if (itemIds.has(item.id)) problems.push(`${where}: duplicate item id`);
      itemIds.add(item.id);
      if (item.type === "mcq_single" || item.type === "mcq_multi") {
        const ids = new Set(item.options.map((o) => o.id));
        if (ids.size !== item.options.length) problems.push(`${where}: duplicate option ids`);
        const answers = Array.isArray(item.answer) ? item.answer : [item.answer];
        for (const a of answers) if (!ids.has(a)) problems.push(`${where}: answer ${a} is not an option`);
      }
      if (isCode(item) && item.dataset) {
        if (!item.scoring) problems.push(`${where}: a dataset item needs scoring`);
        const p = item.function.params;
        if (p.length !== 2 || p.some((x) => x.type !== "dataframe")) {
          problems.push(`${where}: a dataset item takes (train, test) dataframes`);
        }
        try {
          splitDataset(loadDataset(dir, item.dataset.file), item.dataset);
        } catch (err) {
          problems.push(`${where}: ${(err as Error).message}`);
        }
      } else if (isCode(item) && item.tests.sample.length === 0) {
        problems.push(`${where}: needs at least one sample test`);
      }
      if (isCode(item) && item.scoring && !item.dataset) problems.push(`${where}: scoring needs a dataset`);
      if (isCode(item) && item.language === "javascript") {
        if (item.dataset) problems.push(`${where}: dataset challenges are Python only`);
        const bad = item.function.params.filter((p) => ["ndarray", "ndarray_int", "tensor", "tensor_int", "dataframe"].includes(p.type));
        if (bad.length) problems.push(`${where}: ${bad.map((p) => p.type).join(", ")} params are Python only`);
        if (item.driver && !item.expose?.length) problems.push(`${where}: a JavaScript driver needs expose (the names it uses)`);
        if (item.preview && !(item.expose ?? [item.function.name]).includes(item.preview.component)) {
          problems.push(`${where}: preview.component must be one of expose`);
        }
      } else if (isCode(item) && (item.expose || item.preview)) {
        problems.push(`${where}: expose and preview are for JavaScript items`);
      }
      if (isCode(item)) {
        const params = item.function.params.length;
        for (const t of [...item.tests.sample, ...item.tests.hidden]) {
          if (t.args.length !== params) problems.push(`${where}: a test has ${t.args.length} args, expected ${params}`);
        }
        if (item.starter.trim() === item.solution.trim()) problems.push(`${where}: starter equals the solution`);
      }
      if (item.type === "design" && new Set(item.rubric.map((r) => r.id)).size !== item.rubric.length) {
        problems.push(`${where}: duplicate rubric ids`);
      }
      if (item.type === "sql" && item.starter.trim() === item.solution.trim()) {
        problems.push(`${where}: starter equals the solution`);
      }
    }
  }
  const trackIds = new Set<string>();
  for (const t of tracks) {
    if (trackIds.has(t.id)) problems.push(`track ${t.id}: duplicate id`);
    trackIds.add(t.id);
  }

  let lists: ListsFile = [];
  const listsPath = path.join(dir, LISTS_FILE);
  if (existsSync(listsPath)) {
    const parsed = ListsFileSchema.safeParse(parseYaml(readFileSync(listsPath, "utf8")));
    if (!parsed.success) {
      problems.push(`${listsPath}: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
    } else {
      lists = parsed.data;
      const listIds = new Set<string>();
      for (const list of lists) {
        if (listIds.has(list.id)) problems.push(`list ${list.id}: duplicate id`);
        listIds.add(list.id);
        for (const id of list.items) if (!itemIds.has(id)) problems.push(`list ${list.id}: unknown item ${id}`);
        for (const id of list.items) {
          if (itemIds.has(id) && itemArea.get(id) !== list.area) problems.push(`list ${list.id} (${list.area}): ${id} is from area ${itemArea.get(id)}`);
        }
        if (new Set(list.items).size !== list.items.length) problems.push(`list ${list.id}: an item is listed twice`);
      }
    }
  }

  if (problems.length) throw new Error(`Invalid arena content:\n  - ${problems.join("\n  - ")}`);
  return { tracks, topics, lists };
}

export class Catalog {
  readonly tracks: CatalogTrack[];
  readonly items: CatalogItem[];
  readonly lists: ListsFile;
  /** Mock templates and the contest schedule (set by loadCatalog). */
  practice: PracticeConfig = { mocks: [], contests: null };
  /** Courses: ordered modules over tracks (set by loadCatalog). */
  courses: CourseConfig[] = [];
  private readonly trackById = new Map<string, CatalogTrack>();
  private readonly topicById = new Map<string, CatalogTopic>();
  private readonly itemById = new Map<string, CatalogItem>();

  constructor(tracks: CatalogTrack[], lists: ListsFile = []) {
    this.tracks = tracks;
    this.lists = lists;
    this.items = tracks.flatMap((t) => t.topics.flatMap((p) => p.items));
    for (const t of tracks) {
      this.trackById.set(t.id, t);
      for (const p of t.topics) {
        this.topicById.set(p.id, p);
        for (const i of p.items) this.itemById.set(i.id, i);
      }
    }
  }

  track = (id: string) => this.trackById.get(id);
  topic = (id: string) => this.topicById.get(id);
  item = (id: string) => this.itemById.get(id);
  topics = () => [...this.topicById.values()];
  list = (id: string) => this.lists.find((l) => l.id === id);

  private readonly areaViews = new Map<Area, Catalog>();

  /** The same catalog restricted to one area (tracks, lists, mocks, courses). Memoised. */
  forArea(area: Area): Catalog {
    let view = this.areaViews.get(area);
    if (!view) {
      view = new Catalog(
        this.tracks.filter((t) => t.area === area),
        this.lists.filter((l) => l.area === area),
      );
      view.practice = { mocks: this.practice.mocks.filter((m) => m.area === area), contests: this.practice.contests };
      view.courses = this.courses.filter((c) => c.area === area);
      this.areaViews.set(area, view);
    }
    return view;
  }
}

const weightOf = (d: ArenaDifficulty) => XP_BY_DIFFICULTY[d];

/** Builds the catalog from sources plus generated tests. */
export function buildCatalog(
  sources: ContentSources,
  generated: GeneratedTests | null,
  dir: string,
): Catalog {
  const stale: string[] = [];
  let order = 0;
  const tracks = [...sources.tracks]
    .sort((a, b) => a.order - b.order)
    .map((track): CatalogTrack => ({
      ...track,
      topics: track.topics.map((topicId): CatalogTopic => {
        const topic = sources.topics.get(topicId)!;
        return {
          ...topic,
          trackId: track.id,
          area: track.area,
          items: topic.items.map((item): CatalogItem => {
            const base = { ...item, topicId, trackId: track.id, area: track.area, order: order++, weight: weightOf(item.difficulty) };
            if (!isJudged(item)) return base;
            const data = isCode(item) && item.dataset ? datasetTests(dir, item) : null;
            const built = generated?.items[item.id];
            if (!built || built.hash !== codeItemHash(item, data?.hash)) {
              stale.push(item.id);
              return base;
            }
            if (data) return { ...base, judge: data.judge, datasetPreview: data.preview };
            return { ...base, judge: { sample: built.sample, hidden: built.hidden } };
          }),
        };
      }),
    }));
  if (generated && stale.length) {
    throw new Error(
      `Arena tests are out of date for: ${stale.join(", ")}. Run \`npm run content:build -w @logixai/arena-service\`.`,
    );
  }
  return new Catalog(tracks, sources.lists);
}

/**
 * Dataset challenges get their tests from the dataset split (the expected
 * output is the true labels); the content build only records that the
 * reference solution reached the required score.
 */
export function datasetTests(dir: string, item: CodeItemSource) {
  const dataset = loadDataset(dir, item.dataset!.file);
  const split = splitDataset(dataset, item.dataset!);
  return {
    hash: dataset.hash,
    preview: split.preview,
    judge: {
      sample: [{ args: split.sample.args, expected: JSON.stringify(split.sample.labels) }],
      hidden: [{ args: split.hidden.args, expected: JSON.stringify(split.hidden.labels) }],
    },
  };
}

/** Loads content/ (sources + tests.generated.json) for the running service. */
export function loadCatalog(dir: string): Catalog {
  const sources = readSources(dir);
  const generatedPath = path.join(dir, GENERATED_FILE);
  const generated = existsSync(generatedPath)
    ? GeneratedTestsSchema.parse(JSON.parse(readFileSync(generatedPath, "utf8")))
    : { items: {} };
  const catalog = buildCatalog(sources, generated, dir);
  applyBrowserRunRecord(catalog.items, readBrowserRunRecord(dir));
  catalog.practice = loadPracticeConfig(dir, catalog);
  catalog.courses = loadCourses(dir, catalog);
  return catalog;
}
