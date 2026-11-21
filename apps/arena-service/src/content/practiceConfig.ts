/**
 * Mock-interview templates (content/mocks.yaml) and the weekly contest
 * schedule (content/contests.yaml). Validated against the catalog when it
 * loads: every mock slot must have enough free items for any learner, and
 * every contest slot enough items (contests unlock Pro questions).
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { ARENA_DIFFICULTIES, ARENA_ITEM_TYPES } from "@logixai/contracts";
import { z } from "@logixai/service-kit";
import type { Catalog, CatalogItem } from "./catalog.js";

const Slug = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "lowercase-words-with-dashes");

const SlotSchema = z.object({
  /** How the slot appears in the template's outline, e.g. "SQL". */
  label: z.string().min(1),
  tracks: z.array(Slug).min(1),
  /** Narrow to these topics (within the tracks). */
  topics: z.array(Slug).min(1).optional(),
  types: z.array(z.enum(ARENA_ITEM_TYPES)).min(1),
  difficulty: z.array(z.enum(ARENA_DIFFICULTIES)).min(1).optional(),
  count: z.number().int().min(1).max(10),
});
export type PracticeSlot = z.infer<typeof SlotSchema>;

export const MockTemplatesSchema = z.array(
  z.object({
    id: Slug,
    title: z.string().min(1),
    summary: z.string().min(1),
    durationMin: z.number().int().min(5).max(240),
    slots: z.array(SlotSchema).min(1),
  }),
);
export type MockTemplate = z.infer<typeof MockTemplatesSchema>[number];

export const ContestsSchema = z.object({
  weekly: z.object({
    /** Contest ids are "<idPrefix>-<number>". */
    idPrefix: Slug,
    /** "Weekly Arena" -> "Weekly Arena #12". */
    title: z.string().min(1),
    /** Start of contest #1, ISO with an offset, e.g. 2026-11-01T10:00:00+05:30. */
    firstStart: z.string().refine((s) => !Number.isNaN(Date.parse(s)) && /[+-]\d\d:\d\d$|Z$/.test(s), "an ISO date-time with an offset"),
    everyDays: z.number().int().min(1).default(7),
    durationMin: z.number().int().min(15).max(600),
    rules: z.string().min(1),
    /** Contest questions must be auto-graded (code, debug, sql). */
    slots: z.array(SlotSchema).min(1),
  }),
});
export type ContestsConfig = z.infer<typeof ContestsSchema>;

export interface PracticeConfig {
  mocks: MockTemplate[];
  contests: ContestsConfig | null;
}

export const MOCKS_FILE = "mocks.yaml";
export const CONTESTS_FILE = "contests.yaml";
const CONTEST_TYPES = new Set(["code", "debug", "sql"]);

/** Items a slot can draw from. */
export function poolFor(catalog: Catalog, slot: PracticeSlot, freeOnly: boolean): CatalogItem[] {
  return catalog.items.filter(
    (i) =>
      slot.tracks.includes(i.trackId) &&
      (!slot.topics || slot.topics.includes(i.topicId)) &&
      slot.types.includes(i.type) &&
      (!slot.difficulty || slot.difficulty.includes(i.difficulty)) &&
      (!freeOnly || i.access === "free"),
  );
}

function readYaml<S extends z.ZodType>(file: string, schema: S, problems: string[]): z.infer<S> | null {
  if (!existsSync(file)) return null;
  const parsed = schema.safeParse(parseYaml(readFileSync(file, "utf8")));
  if (!parsed.success) {
    problems.push(`${file}: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
    return null;
  }
  return parsed.data;
}

export function loadPracticeConfig(dir: string, catalog: Catalog): PracticeConfig {
  const problems: string[] = [];
  const mocks = readYaml(path.join(dir, MOCKS_FILE), MockTemplatesSchema, problems) ?? [];
  const contests = readYaml(path.join(dir, CONTESTS_FILE), ContestsSchema, problems);

  const checkSlots = (where: string, slots: PracticeSlot[], contest: boolean) => {
    for (const [i, slot] of slots.entries()) {
      for (const t of slot.tracks) if (!catalog.track(t)) problems.push(`${where} slot ${i + 1}: unknown track ${t}`);
      for (const t of slot.topics ?? []) if (!catalog.topic(t)) problems.push(`${where} slot ${i + 1}: unknown topic ${t}`);
      if (contest) for (const t of slot.types) if (!CONTEST_TYPES.has(t)) problems.push(`${where} slot ${i + 1}: ${t} isn't auto-graded`);
      // Mocks must work for free learners; contests unlock their own (Pro) questions for everyone.
      const available = poolFor(catalog, slot, !contest).length;
      // Twice the count, so repeat sessions can still differ.
      if (available < slot.count * 2) {
        problems.push(`${where} slot ${i + 1} (${slot.label}): only ${available} ${contest ? "" : "free "}items for ${slot.count} questions`);
      }
    }
  };
  const ids = new Set<string>();
  for (const m of mocks) {
    if (ids.has(m.id)) problems.push(`mock ${m.id}: duplicate id`);
    ids.add(m.id);
    checkSlots(`mock ${m.id}`, m.slots, false);
  }
  if (contests) checkSlots("weekly contest", contests.weekly.slots, true);

  if (problems.length) throw new Error(`Invalid practice config:\n  - ${problems.join("\n  - ")}`);
  return { mocks, contests };
}
