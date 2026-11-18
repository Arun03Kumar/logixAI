import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { XP_BY_DIFFICULTY, type ArenaDifficulty } from "@logixai/contracts";
import { parse as parseYaml } from "yaml";
import {
  GeneratedTestsSchema,
  TopicFileSchema,
  TrackFileSchema,
  type CodeItemSource,
  type GeneratedTests,
  type ItemSource,
  type TopicFile,
  type TrackFile,
} from "./schema.js";

export const GENERATED_FILE = "tests.generated.json";

export interface JudgeTest {
  args: unknown[];
  /** Expected return value, JSON-encoded by the harness. */
  expected: string;
}

export type CatalogItem = ItemSource & {
  topicId: string;
  trackId: string;
  /** Position in the whole catalog (track order, topic order, item order). */
  order: number;
  weight: number;
  /** Code items only: tests with expected outputs from the content build. */
  judge?: { sample: JudgeTest[]; hidden: JudgeTest[] };
};

export interface CatalogTopic extends Omit<TopicFile, "items"> {
  trackId: string;
  items: CatalogItem[];
}

export interface CatalogTrack extends Omit<TrackFile, "topics"> {
  topics: CatalogTopic[];
}

/** What a code item's expected outputs depend on; a change means rebuild. */
export function codeItemHash(item: CodeItemSource): string {
  const basis = JSON.stringify([item.function, item.solution, item.tests, item.tolerance]);
  return createHash("sha256").update(basis).digest("hex").slice(0, 16);
}

export const isCode = (item: ItemSource): item is CodeItemSource =>
  item.type === "code" || item.type === "debug";

/** Reads and validates the YAML sources. Throws one error listing every problem. */
export interface ContentSources {
  tracks: TrackFile[];
  topics: Map<string, TopicFile>;
}

export function readSources(dir: string): ContentSources {
  const problems: string[] = [];
  const tracks: TrackFile[] = [];
  const topics = new Map<string, TopicFile>();

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
      const topic = TopicFileSchema.safeParse(parseYaml(readFileSync(topicPath, "utf8")));
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
  for (const topic of topics.values()) {
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
      if (isCode(item)) {
        const params = item.function.params.length;
        for (const t of [...item.tests.sample, ...item.tests.hidden]) {
          if (t.args.length !== params) problems.push(`${where}: a test has ${t.args.length} args, expected ${params}`);
        }
        if (item.starter.trim() === item.solution.trim()) problems.push(`${where}: starter equals the solution`);
      }
    }
  }
  const trackIds = new Set<string>();
  for (const t of tracks) {
    if (trackIds.has(t.id)) problems.push(`track ${t.id}: duplicate id`);
    trackIds.add(t.id);
  }

  if (problems.length) throw new Error(`Invalid arena content:\n  - ${problems.join("\n  - ")}`);
  return { tracks, topics };
}

export class Catalog {
  readonly tracks: CatalogTrack[];
  readonly items: CatalogItem[];
  private readonly trackById = new Map<string, CatalogTrack>();
  private readonly topicById = new Map<string, CatalogTopic>();
  private readonly itemById = new Map<string, CatalogItem>();

  constructor(tracks: CatalogTrack[]) {
    this.tracks = tracks;
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
}

const weightOf = (d: ArenaDifficulty) => XP_BY_DIFFICULTY[d];

/** Builds the catalog from sources plus generated tests. */
export function buildCatalog(
  sources: ContentSources,
  generated: GeneratedTests | null,
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
          items: topic.items.map((item): CatalogItem => {
            const base = { ...item, topicId, trackId: track.id, order: order++, weight: weightOf(item.difficulty) };
            if (!isCode(item)) return base;
            const built = generated?.items[item.id];
            if (!built || built.hash !== codeItemHash(item)) {
              stale.push(item.id);
              return base;
            }
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
  return new Catalog(tracks);
}

/** Loads content/ (sources + tests.generated.json) for the running service. */
export function loadCatalog(dir: string): Catalog {
  const sources = readSources(dir);
  const generatedPath = path.join(dir, GENERATED_FILE);
  const generated = existsSync(generatedPath)
    ? GeneratedTestsSchema.parse(JSON.parse(readFileSync(generatedPath, "utf8")))
    : { items: {} };
  return buildCatalog(sources, generated);
}
