/**
 * Personalisation for ML Arena: spaced repetition, the skill map (topics and
 * their prerequisites, with mastery) and "what to do next" recommendations.
 * Pure functions over the catalog and one learner's progress rows.
 */
import {
  REVIEW_INTERVALS_DAYS,
  type Recommendation,
  type ReviewEntry,
  type ReviewQueue,
  type ReviewState,
  type SkillMap,
  type SkillNode,
  type TopicRef,
} from "@logixai/contracts";
import type { Catalog, CatalogItem, CatalogTopic } from "../content/catalog.js";
import type { ProgressRecord, ReviewRecord } from "../store/types.js";

export type ProgressMap = Map<string, ProgressRecord>;

const DAY_MS = 24 * 60 * 60 * 1000;
const addDays = (at: Date, days: number) => new Date(at.getTime() + days * DAY_MS);

/* ── Spaced repetition ── */

/** First review a day after the first solve. */
export const firstReview = (now: Date): ReviewRecord => ({ due: addDays(now, REVIEW_INTERVALS_DAYS[0]), intervalDays: REVIEW_INTERVALS_DAYS[0] });

/** After a review: success moves to the next (longer) interval, a miss starts over. */
export function nextReview(previous: ReviewRecord, success: boolean, now: Date): ReviewRecord {
  if (!success) return firstReview(now);
  const next = REVIEW_INTERVALS_DAYS.find((d) => d > previous.intervalDays) ?? REVIEW_INTERVALS_DAYS.at(-1)!;
  return { due: addDays(now, next), intervalDays: next };
}

export const isDue = (row: ProgressRecord | null | undefined, now: Date) =>
  Boolean(row?.status === "solved" && row.review && row.review.due.getTime() <= now.getTime());

export function reviewState(row: ProgressRecord | null, now: Date): ReviewState | undefined {
  if (!row?.review || row.status !== "solved") return undefined;
  return { due: row.review.due.toISOString(), intervalDays: row.review.intervalDays, isDue: isDue(row, now) };
}

const entry = (catalog: Catalog, item: CatalogItem, at: Date): ReviewEntry => ({
  id: item.id,
  title: item.title,
  type: item.type,
  difficulty: item.difficulty,
  topicTitle: catalog.topic(item.topicId)!.title,
  at: at.toISOString(),
});

export function reviewQueue(catalog: Catalog, progress: ProgressMap, now: Date): ReviewQueue {
  const rows = [...progress.values()].filter((r) => catalog.item(r.itemId));
  const due = rows
    .filter((r) => isDue(r, now))
    .sort((a, b) => a.review!.due.getTime() - b.review!.due.getTime())
    .slice(0, 30)
    .map((r) => entry(catalog, catalog.item(r.itemId)!, r.review!.due));
  const retry = rows
    .filter((r) => r.status === "attempted")
    .sort((a, b) => b.lastActivityAt.getTime() - a.lastActivityAt.getTime())
    .slice(0, 30)
    .map((r) => entry(catalog, catalog.item(r.itemId)!, r.lastActivityAt));
  const weekAhead = addDays(now, 7).getTime();
  const upcomingCount = rows.filter(
    (r) => r.status === "solved" && r.review && r.review.due.getTime() > now.getTime() && r.review.due.getTime() <= weekAhead,
  ).length;
  return { due, retry, upcomingCount };
}

/* ── Skill map ── */

export function topicMastery(items: CatalogItem[], progress: ProgressMap): number {
  const total = items.reduce((s, i) => s + i.weight, 0);
  const earned = items.filter((i) => progress.get(i.id)?.status === "solved").reduce((s, i) => s + i.weight, 0);
  return total ? Math.round((earned / total) * 100) / 100 : 0;
}

/** Mastery below this counts as weak (for struggling topics and their causes). */
const WEAK = 0.5;
/** Attempts on still-unsolved items in a topic before we call it a struggle. */
const STRUGGLE_ATTEMPTS = 4;

function struggling(topic: CatalogTopic, progress: ProgressMap, mastery: number): boolean {
  if (mastery >= WEAK) return false;
  const failedAttempts = topic.items.reduce((s, i) => {
    const row = progress.get(i.id);
    return row?.status === "attempted" ? s + row.attempts : s;
  }, 0);
  return failedAttempts >= STRUGGLE_ATTEMPTS;
}

export function skillMap(catalog: Catalog, progress: ProgressMap): SkillMap {
  const topics = catalog.topics();
  const mastery = new Map(topics.map((t) => [t.id, topicMastery(t.items, progress)]));
  const depthMemo = new Map<string, number>();
  const depth = (id: string, seen = new Set<string>()): number => {
    if (depthMemo.has(id)) return depthMemo.get(id)!;
    if (seen.has(id)) return 0; // content validation should prevent cycles; be safe anyway
    seen.add(id);
    const prereqs = catalog.topic(id)?.prerequisites ?? [];
    const d = prereqs.length ? 1 + Math.max(...prereqs.map((p) => depth(p, seen))) : 0;
    depthMemo.set(id, d);
    return d;
  };
  const ref = (id: string): TopicRef => ({ id, title: catalog.topic(id)?.title ?? id });

  /** Weak prerequisites up to two levels down, nearest first. */
  const rootCauses = (id: string): TopicRef[] => {
    const found: string[] = [];
    let frontier = catalog.topic(id)?.prerequisites ?? [];
    for (let level = 0; level < 2 && frontier.length; level++) {
      const next: string[] = [];
      for (const p of frontier) {
        if ((mastery.get(p) ?? 0) < WEAK && !found.includes(p)) found.push(p);
        next.push(...(catalog.topic(p)?.prerequisites ?? []));
      }
      frontier = next;
    }
    return found.map(ref);
  };

  const nodes: SkillNode[] = topics.map((t) => {
    const m = mastery.get(t.id)!;
    const isStruggling = struggling(t, progress, m);
    return {
      id: t.id,
      title: t.title,
      trackId: t.trackId,
      trackTitle: catalog.track(t.trackId)!.title,
      mastery: m,
      solvedCount: t.items.filter((i) => progress.get(i.id)?.status === "solved").length,
      itemCount: t.items.length,
      started: t.items.some((i) => progress.has(i.id)),
      struggling: isStruggling,
      depth: depth(t.id),
      rootCauses: isStruggling ? rootCauses(t.id) : [],
    };
  });
  // Prerequisites from another area aren't on this map.
  const edges = topics.flatMap((t) => t.prerequisites.filter((p) => catalog.topic(p)).map((p) => ({ from: p, to: t.id })));
  return { topics: nodes, edges };
}

/* ── Recommendations ── */

const DIFFICULTY_ORDER = { easy: 0, medium: 1, hard: 2, expert: 3 } as const;

export function recommendations(
  catalog: Catalog,
  progress: ProgressMap,
  now: Date,
  continueItem: CatalogItem | null,
  limit = 6,
): Recommendation[] {
  const out: Recommendation[] = [];
  const used = new Set<string>();
  const add = (kind: Recommendation["kind"], item: CatalogItem | undefined, reason: string) => {
    if (!item || used.has(item.id) || out.length >= limit) return;
    used.add(item.id);
    const topic = catalog.topic(item.topicId)!;
    out.push({
      kind,
      reason,
      item: { id: item.id, title: item.title, type: item.type, difficulty: item.difficulty, topicId: topic.id, topicTitle: topic.title },
    });
  };
  const unsolved = (topic: CatalogTopic | undefined) =>
    (topic?.items ?? [])
      .filter((i) => progress.get(i.id)?.status !== "solved")
      .sort((a, b) => DIFFICULTY_ORDER[a.difficulty] - DIFFICULTY_ORDER[b.difficulty] || a.order - b.order);

  // 1. Reviews that are due.
  const due = [...progress.values()]
    .filter((r) => isDue(r, now) && catalog.item(r.itemId))
    .sort((a, b) => a.review!.due.getTime() - b.review!.due.getTime());
  for (const r of due.slice(0, 2)) add("review", catalog.item(r.itemId), "Due for review — a quick recall keeps it fresh.");

  // 2. Carry on where the learner left off.
  if (continueItem) add("continue", continueItem, "Pick up where you left off.");

  // 3. Shore up the weak prerequisites behind a struggling topic (nearest first, at most 3).
  const map = skillMap(catalog, progress);
  let strengthen = 0;
  for (const node of map.topics.filter((t) => t.struggling)) {
    for (const cause of node.rootCauses) {
      if (strengthen >= 3) break;
      const before = out.length;
      add("strengthen", unsolved(catalog.topic(cause.id))[0], `Builds the ${cause.title.toLowerCase()} skills behind ${node.title.toLowerCase()}.`);
      if (out.length > before) strengthen++;
    }
  }

  // 4. New topics whose prerequisites are covered.
  const mastery = new Map(map.topics.map((t) => [t.id, t.mastery]));
  for (const topic of catalog.topics()) {
    if (out.length >= limit) break;
    if (topic.items.some((i) => progress.has(i.id))) continue;
    const ready = topic.prerequisites.every((p) => (mastery.get(p) ?? 0) >= WEAK);
    if (!ready) continue;
    add(
      "next",
      unsolved(topic)[0],
      topic.prerequisites.length ? "You've covered what this topic builds on." : "A good place to start.",
    );
  }
  return out;
}
