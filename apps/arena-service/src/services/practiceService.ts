/**
 * Mock interviews, weekly contests and public profiles.
 *
 * Both mocks and contests are "sessions": a set of questions and a time
 * window. ArenaService reports every graded answer and submit through
 * `onOutcome`, and open sessions containing that item record it — so the
 * normal item pages are used for solving, with no special mode.
 */
import { randomInt } from "node:crypto";
import {
  XP_BY_DIFFICULTY,
  type ArenaDifficulty,
  type ContestSummary,
  type ContestView,
  type LeaderboardRow,
  type MockHub,
  type ProfileInput,
  type ProfileSettings,
  type PublicProfile,
  type SessionItemView,
  type SessionSummary,
  type SessionView,
} from "@logixai/contracts";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "@logixai/service-kit";
import type { Catalog, CatalogItem } from "../content/catalog.js";
import { poolFor, type ContestsConfig, type PracticeSlot } from "../content/practiceConfig.js";
import { addDays, dayOf, streaks } from "../lib/days.js";
import type { ProfileRecord, SessionEvent, SessionRecord, Store } from "../store/types.js";

/** Free plan: mock interviews per rolling 7 days. */
export const FREE_MOCKS_PER_WEEK = 3;
/** Contest points by difficulty (LeetCode-style). */
export const CONTEST_POINTS: Record<ArenaDifficulty, number> = { easy: 3, medium: 4, hard: 5, expert: 6 };
/** Penalty minutes per failed submit before a solve. */
export const WRONG_PENALTY_MIN = 5;
const LEADERBOARD_SIZE = 100;
const WEEK_MS = 7 * 86_400_000;
const RESERVED_HANDLES = new Set(["admin", "support", "logixai", "api", "settings", "me", "null", "undefined", "root"]);

export interface Viewer {
  userId: string;
  /** From the access token, for leaderboards. */
  name: string;
  pro: boolean;
}

interface Contest {
  id: string;
  number: number;
  title: string;
  startsAt: Date;
  endsAt: Date;
}

/** "Asha Kumar" -> "Asha K." — leaderboards don't show full names. */
export function shortName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "Anonymous";
  return parts.length === 1 ? parts[0]! : `${parts[0]} ${parts[parts.length - 1]![0]!.toUpperCase()}.`;
}

/** Small deterministic PRNG (mulberry32): the same contest number gives the same questions. */
function seeded(seed: number) {
  let a = seed >>> 0;
  return (n: number) => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * n);
  };
}

function shuffle<T>(items: T[], rand: (n: number) => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = rand(i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

const over = (s: SessionRecord, now: Date) => s.finishedAt !== null || s.endsAt <= now;
const minutes = (ms: number) => Math.floor(ms / 60_000);

export class PracticeService {
  private readonly now: () => Date;

  constructor(private readonly deps: { catalog: Catalog; store: Store; now?: () => Date }) {
    this.now = deps.now ?? (() => new Date());
  }

  private get catalog() {
    return this.deps.catalog;
  }

  /* ── Hooks used by the item routes ── */

  /** Records a graded answer or submit in every open session that contains the item. */
  async onOutcome(userId: string, itemId: string, event: SessionEvent, at: Date): Promise<void> {
    for (const s of await this.deps.store.sessions.findOpen(userId, at)) {
      if (s.itemIds.includes(itemId)) await this.deps.store.sessions.recordOutcome(s.id, itemId, event, at);
    }
  }

  /** The item is part of a session in progress (solutions stay hidden). */
  async inOpenSession(userId: string, itemId: string): Promise<boolean> {
    return (await this.deps.store.sessions.findOpen(userId, this.now())).some((s) => s.itemIds.includes(itemId));
  }

  /** Contests are open to everyone: an open contest entry unlocks its own Pro questions. */
  async unlocks(userId: string, itemId: string): Promise<boolean> {
    return (await this.deps.store.sessions.findOpen(userId, this.now())).some((s) => s.kind === "contest" && s.itemIds.includes(itemId));
  }

  /* ── Sessions ── */

  private item(id: string): CatalogItem | undefined {
    return this.catalog.item(id);
  }

  private itemViews(s: SessionRecord): SessionItemView[] {
    return s.itemIds.flatMap((id) => {
      const item = this.item(id);
      if (!item) return [];
      const o = s.outcomes[id];
      const topic = this.catalog.topic(item.topicId);
      const track = this.catalog.track(item.trackId);
      return [
        {
          id,
          title: item.title,
          type: item.type,
          difficulty: item.difficulty,
          topicTitle: topic?.title ?? "",
          trackTitle: track?.title ?? "",
          solved: Boolean(o?.solvedAt),
          solvedAfterMin: o?.solvedAt ? minutes(o.solvedAt.getTime() - s.scoreFrom.getTime()) : null,
          wrongAttempts: o?.wrong ?? 0,
        },
      ];
    });
  }

  /** Contest scoring: points by difficulty, penalty = minutes to each solve + 5 per failed submit before it. */
  private score(s: SessionRecord) {
    let points = 0;
    let penaltyMin = 0;
    let solved = 0;
    let weight = 0;
    let earned = 0;
    let lastSolve = 0;
    for (const id of s.itemIds) {
      const item = this.item(id);
      if (!item) continue;
      const w = XP_BY_DIFFICULTY[item.difficulty];
      weight += w;
      const o = s.outcomes[id];
      if (!o?.solvedAt) continue;
      solved += 1;
      earned += w;
      points += CONTEST_POINTS[item.difficulty];
      penaltyMin += minutes(o.solvedAt.getTime() - s.scoreFrom.getTime()) + WRONG_PENALTY_MIN * o.wrong;
      lastSolve = Math.max(lastSolve, o.solvedAt.getTime());
    }
    return { points, penaltyMin, solved, total: s.itemIds.length, fraction: weight ? earned / weight : 0, lastSolve };
  }

  private summary(s: SessionRecord): SessionSummary {
    const sc = this.score(s);
    return {
      id: s.id,
      kind: s.kind,
      title: s.title,
      sourceId: s.sourceId,
      startedAt: s.startedAt.toISOString(),
      over: over(s, this.now()),
      solved: sc.solved,
      total: sc.total,
      score: sc.fraction,
    };
  }

  private view(s: SessionRecord): SessionView {
    const now = this.now();
    const done = over(s, now);
    const sc = this.score(s);
    const items = this.itemViews(s);
    const view: SessionView = {
      id: s.id,
      kind: s.kind,
      title: s.title,
      sourceId: s.sourceId,
      startedAt: s.startedAt.toISOString(),
      endsAt: s.endsAt.toISOString(),
      finishedAt: s.finishedAt ? s.finishedAt.toISOString() : null,
      over: done,
      ranked: s.ranked,
      items,
      ...(s.kind === "contest" ? { points: sc.points, penaltyMin: sc.penaltyMin } : {}),
    };
    if (done) {
      const missed = s.itemIds.filter((id) => !s.outcomes[id]?.solvedAt).map((id) => this.item(id)).filter(Boolean) as CatalogItem[];
      const topics = [...new Map(missed.map((i) => [i.topicId, this.catalog.topic(i.topicId)?.title ?? i.topicId])).entries()];
      view.report = {
        score: sc.fraction,
        solved: sc.solved,
        total: sc.total,
        verdict: sc.fraction >= 0.7 ? "strong" : sc.fraction >= 0.4 ? "borderline" : "needs-work",
        practiceNext: topics.map(([topicId, topicTitle]) => ({ topicId, topicTitle })),
      };
    }
    return view;
  }

  private async mine(userId: string, id: string): Promise<SessionRecord> {
    const s = await this.deps.store.sessions.get(id);
    if (!s || s.userId !== userId) throw new NotFoundError("Session", id);
    return s;
  }

  async getSession(userId: string, id: string): Promise<SessionView> {
    return this.view(await this.mine(userId, id));
  }

  async finishSession(userId: string, id: string): Promise<SessionView> {
    const s = await this.mine(userId, id);
    await this.deps.store.sessions.finish(s.id, this.now());
    return this.view((await this.deps.store.sessions.get(s.id))!);
  }

  private async requireNoOpenSession(userId: string) {
    const open = await this.deps.store.sessions.findOpen(userId, this.now());
    if (open.length) {
      throw new ConflictError(`You're already in "${open[0]!.title}". Finish it (or end it early) before starting another.`);
    }
  }

  /** Picks distinct items for the slots. `prefer` items are drawn before the rest. */
  private pick(slots: PracticeSlot[], freeOnly: boolean, rand: (n: number) => number, deprioritise: Set<string>): string[] {
    const chosen: string[] = [];
    for (const slot of slots) {
      const pool = poolFor(this.catalog, slot, freeOnly).filter((i) => !chosen.includes(i.id));
      const fresh = shuffle(pool.filter((i) => !deprioritise.has(i.id)), rand);
      const seen = shuffle(pool.filter((i) => deprioritise.has(i.id)), rand);
      chosen.push(...[...fresh, ...seen].slice(0, slot.count).map((i) => i.id));
    }
    return chosen;
  }

  /* ── Mock interviews ── */

  async mockHub(viewer: Viewer): Promise<MockHub> {
    const now = this.now();
    const sessions = await this.deps.store.sessions.listForUser(viewer.userId, 30);
    const open = sessions.find((s) => !over(s, now)) ?? null;
    const used = await this.deps.store.sessions.countSince(viewer.userId, "mock", new Date(now.getTime() - WEEK_MS));
    return {
      templates: this.catalog.practice.mocks.map((m) => ({
        id: m.id,
        title: m.title,
        summary: m.summary,
        durationMin: m.durationMin,
        questionCount: m.slots.reduce((n, s) => n + s.count, 0),
        outline: m.slots.map((s) => `${s.count} ${s.label}`),
      })),
      active: open ? this.summary(open) : null,
      history: sessions.filter((s) => s.kind === "mock" && over(s, now)).slice(0, 20).map((s) => this.summary(s)),
      remainingThisWeek: viewer.pro ? null : Math.max(0, FREE_MOCKS_PER_WEEK - used),
    };
  }

  async startMock(viewer: Viewer, templateId: string): Promise<SessionView> {
    const template = this.catalog.practice.mocks.find((m) => m.id === templateId);
    if (!template) throw new NotFoundError("Mock interview", templateId);
    const now = this.now();
    await this.requireNoOpenSession(viewer.userId);
    if (!viewer.pro && (await this.deps.store.sessions.countSince(viewer.userId, "mock", new Date(now.getTime() - WEEK_MS))) >= FREE_MOCKS_PER_WEEK) {
      throw new ForbiddenError(`The free plan includes ${FREE_MOCKS_PER_WEEK} mock interviews a week. Pro has no limit — or come back in a few days.`);
    }
    const solved = new Set(
      (await this.deps.store.progress.listForUser(viewer.userId)).filter((p) => p.status === "solved").map((p) => p.itemId),
    );
    const itemIds = this.pick(template.slots, !viewer.pro, randomInt, solved);
    const s = await this.deps.store.sessions.create({
      userId: viewer.userId,
      kind: "mock",
      sourceId: template.id,
      title: template.title,
      itemIds,
      startedAt: now,
      endsAt: new Date(now.getTime() + template.durationMin * 60_000),
      finishedAt: null,
      ranked: false,
      scoreFrom: now,
      displayName: shortName(viewer.name),
      outcomes: {},
    });
    return this.view(s);
  }

  /* ── Contests ── */

  private get weekly(): ContestsConfig["weekly"] | null {
    return this.catalog.practice.contests?.weekly ?? null;
  }

  private contest(number: number): Contest | null {
    const w = this.weekly;
    if (!w || number < 1 || !Number.isInteger(number)) return null;
    const startsAt = new Date(Date.parse(w.firstStart) + (number - 1) * w.everyDays * 86_400_000);
    return {
      id: `${w.idPrefix}-${number}`,
      number,
      title: `${w.title} #${number}`,
      startsAt,
      endsAt: new Date(startsAt.getTime() + w.durationMin * 60_000),
    };
  }

  private contestById(id: string): Contest {
    const w = this.weekly;
    const m = w ? new RegExp(`^${w.idPrefix}-(\\d{1,5})$`).exec(id) : null;
    const c = m ? this.contest(Number(m[1])) : null;
    if (!c) throw new NotFoundError("Contest", id);
    return c;
  }

  /** The contest number running now, or the last one that started. */
  private currentNumber(now: Date): number {
    const w = this.weekly!;
    return Math.floor((now.getTime() - Date.parse(w.firstStart)) / (w.everyDays * 86_400_000)) + 1;
  }

  private status(c: Contest, now: Date): ContestSummary["status"] {
    return now < c.startsAt ? "upcoming" : now < c.endsAt ? "live" : "ended";
  }

  /** The questions, drawn deterministically from the pools (contests may include Pro items). */
  private contestItems(c: Contest): string[] {
    return this.pick(this.weekly!.slots, false, seeded(c.number * 7919 + 17), new Set());
  }

  async listContests(): Promise<ContestSummary[]> {
    if (!this.weekly) return [];
    const now = this.now();
    const current = this.currentNumber(now);
    const numbers = [];
    for (let n = Math.max(1, current - 5); n <= Math.max(1, current + 1); n++) numbers.push(n);
    const contests = numbers.map((n) => this.contest(n)!).reverse();
    return Promise.all(contests.map((c) => this.contestSummary(c, now)));
  }

  private async contestSummary(c: Contest, now: Date): Promise<ContestSummary> {
    const participants = now >= c.startsAt ? (await this.deps.store.sessions.listForSource(c.id, true)).length : 0;
    return {
      id: c.id,
      title: c.title,
      startsAt: c.startsAt.toISOString(),
      endsAt: c.endsAt.toISOString(),
      status: this.status(c, now),
      questionCount: this.weekly!.slots.reduce((n, s) => n + s.count, 0),
      participants,
    };
  }

  private async leaderboard(c: Contest, userId: string | null): Promise<{ rows: LeaderboardRow[]; all: LeaderboardRow[] }> {
    const entries = (await this.deps.store.sessions.listForSource(c.id, true)).map((s) => ({ s, sc: this.score(s) }));
    entries.sort((a, b) => b.sc.points - a.sc.points || a.sc.penaltyMin - b.sc.penaltyMin || a.sc.lastSolve - b.sc.lastSolve);
    const profiles = new Map(
      (await this.deps.store.profiles.getMany(entries.map((e) => e.s.userId))).filter((p) => p.public).map((p) => [p.userId, p]),
    );
    const all: LeaderboardRow[] = [];
    entries.forEach(({ s, sc }, i) => {
      const prev = all[i - 1];
      const tied = prev && prev.points === sc.points && prev.penaltyMin === sc.penaltyMin;
      const profile = profiles.get(s.userId);
      all.push({
        rank: tied ? prev.rank : i + 1,
        name: profile?.displayName ?? s.displayName,
        handle: profile?.handle ?? null,
        points: sc.points,
        penaltyMin: sc.penaltyMin,
        solved: sc.solved,
        me: s.userId === userId,
      });
    });
    return { rows: all.slice(0, LEADERBOARD_SIZE), all };
  }

  async getContest(userId: string | null, id: string): Promise<ContestView> {
    const c = this.contestById(id);
    const now = this.now();
    const summary = await this.contestSummary(c, now);
    const started = summary.status !== "upcoming";
    // Show what participants actually got, if anyone joined (content can change later).
    const snapshot = started ? (await this.deps.store.sessions.listForSource(c.id, true))[0]?.itemIds : undefined;
    const itemIds = started ? (snapshot ?? this.contestItems(c)) : [];
    const { rows, all } = started ? await this.leaderboard(c, userId) : { rows: [], all: [] };
    const mine = userId ? await this.deps.store.sessions.latestForUserAndSource(userId, c.id) : null;
    return {
      ...summary,
      rules: this.weekly!.rules,
      items: started
        ? itemIds.flatMap((iid) => {
            const item = this.item(iid);
            return item ? [{ id: iid, title: item.title, type: item.type, difficulty: item.difficulty, points: CONTEST_POINTS[item.difficulty] }] : [];
          })
        : null,
      leaderboard: rows,
      myRow: all.find((r) => r.me) ?? null,
      mySession: mine ? this.summary(mine) : null,
    };
  }

  async joinContest(viewer: Viewer, id: string): Promise<SessionView> {
    const c = this.contestById(id);
    const now = this.now();
    const status = this.status(c, now);
    if (status === "upcoming") throw new ConflictError(`${c.title} starts at ${c.startsAt.toISOString()}.`);
    const existing = await this.deps.store.sessions.latestForUserAndSource(viewer.userId, c.id);
    if (existing && (status === "live" ? existing.ranked : !over(existing, now))) return this.view(existing);
    await this.requireNoOpenSession(viewer.userId);
    const live = status === "live";
    const snapshot = (await this.deps.store.sessions.listForSource(c.id, true))[0]?.itemIds;
    const s = await this.deps.store.sessions.create({
      userId: viewer.userId,
      kind: "contest",
      sourceId: c.id,
      title: live ? c.title : `${c.title} (virtual)`,
      itemIds: snapshot ?? this.contestItems(c),
      startedAt: now,
      // Live: the contest's own clock. Virtual: the same length, from now.
      endsAt: live ? c.endsAt : new Date(now.getTime() + (c.endsAt.getTime() - c.startsAt.getTime())),
      finishedAt: null,
      ranked: live,
      scoreFrom: live ? c.startsAt : now,
      displayName: shortName(viewer.name),
      outcomes: {},
    });
    return this.view(s);
  }

  /* ── Profiles ── */

  private settings(p: ProfileRecord, saved: boolean): ProfileSettings {
    return { handle: p.handle, displayName: p.displayName, bio: p.bio, public: p.public, url: `/u/${p.handle}`, saved };
  }

  async myProfile(viewer: Viewer): Promise<ProfileSettings> {
    const p = await this.deps.store.profiles.get(viewer.userId);
    if (p) return this.settings(p, true);
    const suggestion = (viewer.name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "learner").slice(0, 14);
    const handle = suggestion.length >= 3 ? suggestion : `${suggestion}_ml`;
    return { handle, displayName: shortName(viewer.name), bio: "", public: false, url: `/u/${handle}`, saved: false };
  }

  async saveProfile(viewer: Viewer, input: ProfileInput): Promise<ProfileSettings> {
    if (RESERVED_HANDLES.has(input.handle)) throw new BadRequestError("handle", { reason: "That handle is reserved." });
    try {
      const p = await this.deps.store.profiles.upsert({ userId: viewer.userId, ...input }, this.now());
      return this.settings(p, true);
    } catch (err) {
      if ((err as { code?: number }).code === 11000) throw new ConflictError("That handle is taken. Try another.");
      throw err;
    }
  }

  async publicProfile(handle: string): Promise<PublicProfile> {
    const p = await this.deps.store.profiles.getByHandle(handle.toLowerCase());
    // Private and missing profiles look the same.
    if (!p || !p.public) throw new NotFoundError("Profile", handle);
    const now = this.now();
    const [stats, progress, sessions] = await Promise.all([
      this.deps.store.stats.get(p.userId),
      this.deps.store.progress.listForUser(p.userId),
      this.deps.store.sessions.listForUser(p.userId, 100),
    ]);
    const days = stats?.days ?? {};
    const since = addDays(dayOf(now), -84);
    const solved = progress.filter((r) => r.status === "solved");
    const solvedIds = new Set(solved.map((r) => r.itemId));
    const contests = [];
    for (const s of sessions.filter((x) => x.kind === "contest" && x.ranked && over(x, now)).slice(0, 5)) {
      const c = this.contestById(s.sourceId);
      const { all } = await this.leaderboard(c, p.userId);
      const row = all.find((r) => r.me);
      if (row) contests.push({ id: c.id, title: c.title, rank: row.rank, participants: all.length, points: row.points });
    }
    const st = streaks(Object.keys(days), dayOf(now));
    return {
      handle: p.handle,
      displayName: p.displayName,
      bio: p.bio,
      memberSince: p.createdAt.toISOString(),
      xp: stats?.xp ?? 0,
      solvedCount: stats?.solvedCount ?? 0,
      streak: { current: st.current, longest: st.longest },
      activity: Object.fromEntries(Object.entries(days).filter(([d]) => d >= since)),
      tracks: this.catalog.tracks.map((t) => {
        const ids = t.topics.flatMap((x) => x.items.map((i) => i.id));
        return { id: t.id, title: t.title, solved: ids.filter((id) => solvedIds.has(id)).length, total: ids.length };
      }),
      recent: solved
        .filter((r) => r.solvedAt && this.item(r.itemId))
        .sort((a, b) => b.solvedAt!.getTime() - a.solvedAt!.getTime())
        .slice(0, 8)
        .map((r) => ({ itemId: r.itemId, title: this.item(r.itemId)!.title, solvedAt: r.solvedAt!.toISOString() })),
      contests,
      mocksCompleted: sessions.filter((s) => s.kind === "mock" && over(s, now)).length,
    };
  }
}
