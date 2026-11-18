import {
  XP_BY_DIFFICULTY,
  isCodeItem,
  levelForXp,
  type AnswerInput,
  type AnswerResult,
  type ArenaDashboard,
  type ArenaSubmissionSummary,
  type ArenaSubmissionView,
  type ArenaTestResult,
  type CodeRunInput,
  type EvaluationJobPayload,
  type ItemStatus,
  type ItemSummary,
  type ItemView,
  type TopicDetail,
  type TopicSummary,
  type TrackDetail,
  type TrackSummary,
} from "@logixai/contracts";
import { BadRequestError, ConflictError, InternalServerError, NotFoundError } from "@logixai/service-kit";
import type { Catalog, CatalogItem, CatalogTopic, CatalogTrack } from "../content/catalog.js";
import { buildJudgeProgram, formatCall } from "../content/harness.js";
import { addDays, dayOf, streaks } from "../lib/days.js";
import type { Page, ProgressRecord, Store, SubmissionRecord } from "../store/types.js";

export interface JudgeRequest {
  submissionId: string;
  userId: string;
  program: string;
  tests: { input: string; output: string }[];
  tolerance: { abs: number; rel: number };
}

export interface JudgeGateway {
  submit(request: JudgeRequest): Promise<void>;
}

export interface Deps {
  catalog: Catalog;
  store: Store;
  judge: JudgeGateway;
  now?: () => Date;
}

/** A learner may have one run waiting for the judge at a time (stale after this). */
const PENDING_WINDOW_MS = 60_000;
const ACTIVITY_DAYS = 84;

type ProgressMap = Map<string, ProgressRecord>;

const normalizeLines = (text: string) =>
  text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.trimEnd())
    .join("\n")
    .replace(/^\n+|\n+$/g, "");

/** First solve earns XP by difficulty; solving after revealing earns none. */
const xpFor = (item: CatalogItem, before: ItemStatus | null) =>
  before === "revealed" || before === "solved" ? 0 : XP_BY_DIFFICULTY[item.difficulty];

export class ArenaService {
  private readonly now: () => Date;

  constructor(private readonly deps: Deps) {
    this.now = deps.now ?? (() => new Date());
  }

  private get catalog() {
    return this.deps.catalog;
  }

  private async progressMap(userId: string | null): Promise<ProgressMap> {
    if (!userId) return new Map();
    const rows = await this.deps.store.progress.listForUser(userId);
    return new Map(rows.map((r) => [r.itemId, r]));
  }

  private mustItem(id: string): CatalogItem {
    const item = this.catalog.item(id);
    if (!item) throw new NotFoundError("Item", id);
    return item;
  }

  /* ── Catalog views ── */

  private itemSummary(item: CatalogItem, progress: ProgressMap): ItemSummary {
    return {
      id: item.id,
      title: item.title,
      type: item.type,
      difficulty: item.difficulty,
      access: item.access,
      status: progress.get(item.id)?.status ?? null,
    };
  }

  private mastery(items: CatalogItem[], progress: ProgressMap) {
    const total = items.reduce((s, i) => s + i.weight, 0);
    const solved = items.filter((i) => progress.get(i.id)?.status === "solved");
    const earned = solved.reduce((s, i) => s + i.weight, 0);
    return { solvedCount: solved.length, mastery: total ? Math.round((earned / total) * 100) / 100 : 0 };
  }

  private topicSummary(topic: CatalogTopic, progress: ProgressMap): TopicSummary {
    return {
      id: topic.id,
      title: topic.title,
      summary: topic.summary,
      prerequisites: topic.prerequisites.map((id) => ({ id, title: this.catalog.topic(id)?.title ?? id })),
      itemCount: topic.items.length,
      ...this.mastery(topic.items, progress),
    };
  }

  private trackSummary(track: CatalogTrack, progress: ProgressMap): TrackSummary {
    const items = track.topics.flatMap((t) => t.items);
    return {
      id: track.id,
      title: track.title,
      summary: track.summary,
      level: track.level,
      topicCount: track.topics.length,
      itemCount: items.length,
      ...this.mastery(items, progress),
    };
  }

  async listTracks(userId: string | null): Promise<TrackSummary[]> {
    const progress = await this.progressMap(userId);
    return this.catalog.tracks.map((t) => this.trackSummary(t, progress));
  }

  async getTrack(userId: string | null, trackId: string): Promise<TrackDetail> {
    const track = this.catalog.track(trackId);
    if (!track) throw new NotFoundError("Track", trackId);
    const progress = await this.progressMap(userId);
    return { ...this.trackSummary(track, progress), topics: track.topics.map((t) => this.topicSummary(t, progress)) };
  }

  async getTopic(userId: string | null, topicId: string): Promise<TopicDetail> {
    const topic = this.catalog.topic(topicId);
    if (!topic) throw new NotFoundError("Topic", topicId);
    const track = this.catalog.track(topic.trackId)!;
    const progress = await this.progressMap(userId);
    const index = track.topics.findIndex((t) => t.id === topic.id);
    const ref = (t: CatalogTopic | undefined) => (t ? { id: t.id, title: t.title } : null);
    return {
      ...this.topicSummary(topic, progress),
      trackId: track.id,
      trackTitle: track.title,
      lesson: topic.lesson,
      items: topic.items.map((i) => this.itemSummary(i, progress)),
      previousTopic: ref(track.topics[index - 1]),
      nextTopic: ref(track.topics[index + 1]),
    };
  }

  private itemView(item: CatalogItem, row: ProgressRecord | null): ItemView {
    const topic = this.catalog.topic(item.topicId)!;
    const neighbour = (offset: number) => {
      const other = this.catalog.items[item.order + offset];
      return other && other.trackId === item.trackId ? { id: other.id, title: other.title } : null;
    };
    const open = row?.status === "solved" || row?.status === "revealed";
    const view: ItemView = {
      ...this.itemSummary(item, new Map(row ? [[item.id, row]] : [])),
      topic: { id: topic.id, title: topic.title },
      trackId: item.trackId,
      tags: item.tags,
      prompt: item.prompt,
      hints: item.hints,
      previousItem: neighbour(-1),
      nextItem: neighbour(1),
      ...(row?.lastAnswer != null ? { lastAnswer: row.lastAnswer } : {}),
    };
    switch (item.type) {
      case "mcq_single":
      case "mcq_multi":
        view.options = item.options;
        if (open) view.answer = Array.isArray(item.answer) ? item.answer : [item.answer];
        break;
      case "numeric":
        if (item.answerFormat) view.answerFormat = item.answerFormat;
        if (open) view.answer = String(item.answer);
        break;
      case "output":
        view.snippet = item.snippet;
        if (open) view.answer = item.answer;
        break;
      case "code":
      case "debug":
        view.starterCode = item.starter;
        view.signature = { name: item.function.name, params: item.function.params, returns: item.function.returns };
        view.samples = (item.judge?.sample ?? []).map((t) => ({
          call: formatCall(item.function.name, t.args),
          expected: t.expected,
        }));
        view.hiddenTestCount = item.judge?.hidden.length ?? 0;
        if (open) view.solution = item.solution;
        break;
    }
    if (open) view.explanation = item.explanation;
    return view;
  }

  async getItem(userId: string | null, itemId: string): Promise<ItemView> {
    const item = this.mustItem(itemId);
    const row = userId ? await this.deps.store.progress.get(userId, itemId) : null;
    return this.itemView(item, row);
  }

  /** Gives up on an item: shows the answer and explanation. Solving it later earns no XP. */
  async reveal(userId: string, itemId: string): Promise<ItemView> {
    const item = this.mustItem(itemId);
    await this.deps.store.progress.markRevealed(userId, itemId, this.now());
    await this.deps.store.stats.record(userId, dayOf(this.now()), { xp: 0, solved: 0 });
    return this.itemView(item, await this.deps.store.progress.get(userId, itemId));
  }

  /* ── Answering ── */

  private grade(item: CatalogItem, input: AnswerInput): boolean {
    switch (item.type) {
      case "mcq_single":
      case "mcq_multi": {
        if (!("selectedOptionIds" in input)) throw new BadRequestError("answer", { reason: "Pick an option." });
        const expected = new Set(Array.isArray(item.answer) ? item.answer : [item.answer]);
        const picked = new Set(input.selectedOptionIds);
        return picked.size === expected.size && [...picked].every((id) => expected.has(id));
      }
      case "numeric":
        if (!("value" in input)) throw new BadRequestError("answer", { reason: "Enter a number." });
        return Math.abs(input.value - item.answer) <= item.tolerance;
      case "output":
        if (!("text" in input)) throw new BadRequestError("answer", { reason: "Type the output." });
        return normalizeLines(input.text) === normalizeLines(item.answer);
      default:
        throw new BadRequestError("answer", { reason: "Run or submit your code for this item." });
    }
  }

  /** Records a solve: XP and solved count only on the first solve. Returns XP gained. */
  private async solve(userId: string, item: CatalogItem, statusBefore: ItemStatus | null): Promise<number> {
    const xp = xpFor(item, statusBefore);
    const before = await this.deps.store.progress.markSolved(userId, item.id, xp, this.now());
    const firstSolve = before !== "solved";
    const gained = firstSolve ? xpFor(item, before) : 0;
    await this.deps.store.stats.record(userId, dayOf(this.now()), { xp: gained, solved: firstSolve ? 1 : 0 });
    return gained;
  }

  async answer(userId: string, itemId: string, input: AnswerInput): Promise<AnswerResult> {
    const item = this.mustItem(itemId);
    const correct = this.grade(item, input);
    const row = await this.deps.store.progress.recordAttempt(userId, itemId, input, this.now());
    if (!correct) {
      await this.deps.store.stats.record(userId, dayOf(this.now()), { xp: 0, solved: 0 });
      const open = row.status === "solved" || row.status === "revealed";
      return { correct: false, status: row.status, xpGained: 0, ...(open ? this.answerDetails(item) : {}) };
    }
    const xpGained = await this.solve(userId, item, row.status);
    return { correct: true, status: "solved", xpGained, ...this.answerDetails(item) };
  }

  private answerDetails(item: CatalogItem): Pick<AnswerResult, "explanation" | "answer"> {
    const view = this.itemView(item, { status: "solved" } as ProgressRecord);
    return { explanation: item.explanation, ...(view.answer !== undefined ? { answer: view.answer } : {}) };
  }

  /* ── Code ── */

  async runCode(userId: string, itemId: string, input: CodeRunInput): Promise<ArenaSubmissionView> {
    const item = this.mustItem(itemId);
    if (!isCodeItem(item.type) || !("function" in item)) {
      throw new BadRequestError("item", { reason: "This item takes an answer, not code." });
    }
    if (!item.judge) throw new InternalServerError({ reason: `Tests for ${item.id} haven't been built` });
    const now = this.now();
    if ((await this.deps.store.submissions.countPendingSince(userId, new Date(now.getTime() - PENDING_WINDOW_MS))) > 0) {
      throw new ConflictError("Your previous run is still being judged. Try again in a moment.");
    }
    const tests = input.mode === "submit" ? [...item.judge.sample, ...item.judge.hidden] : item.judge.sample;
    const submission = await this.deps.store.submissions.create({
      userId,
      itemId,
      mode: input.mode,
      code: input.code,
      status: "pending",
      passed: 0,
      total: tests.length,
      tests: [],
      xpGained: 0,
      createdAt: now,
      judgedAt: null,
    });
    await this.deps.store.progress.recordAttempt(userId, itemId, { code: input.code }, now);
    await this.deps.store.stats.record(userId, dayOf(now), { xp: 0, solved: 0 });
    try {
      await this.deps.judge.submit({
        submissionId: submission.id,
        userId,
        program: buildJudgeProgram(item.function, input.code),
        tests: tests.map((t) => ({ input: JSON.stringify({ args: t.args }), output: t.expected })),
        tolerance: item.tolerance,
      });
    } catch (err) {
      await this.deps.store.submissions.complete(submission.id, {
        status: "error",
        passed: 0,
        total: tests.length,
        tests: [],
        judgedAt: this.now(),
      });
      throw err;
    }
    return this.submissionView(submission);
  }

  /** Applies a judge result (from ArenaEvaluationQueue). */
  async applyJudgeResult(payload: EvaluationJobPayload): Promise<void> {
    const submission = await this.deps.store.submissions.get(payload.submissionId);
    if (!submission || submission.status !== "pending") return;
    const item = this.catalog.item(submission.itemId);
    const sample = item?.judge?.sample ?? [];
    const fnName = item && "function" in item ? item.function.name : "f";
    const responses = payload.response;

    let tests: ArenaTestResult[];
    let status: SubmissionRecord["status"];
    if (responses.length !== submission.total) {
      // The judge returns a single result when the code couldn't run at all.
      const only = responses[0];
      tests = only ? [{ index: 0, sample: true, verdict: only.status, message: only.output }] : [];
      status = only?.status === "ERROR" || !only ? "error" : "failed";
    } else {
      tests = responses.map((r, index): ArenaTestResult => {
        const isSample = index < sample.length;
        const ran = r.status === "SUCCESS" || r.status === "WA";
        const base = { index, sample: isSample, verdict: r.status, ...(r.timeMs !== undefined ? { timeMs: r.timeMs } : {}) };
        if (!isSample) {
          // Never echo anything from hidden tests: error text could leak their inputs.
          return base;
        }
        const t = sample[index]!;
        return {
          ...base,
          call: formatCall(fnName, t.args),
          expected: t.expected,
          ...(ran ? { output: r.output } : { message: r.output }),
        };
      });
      status = responses.every((r) => r.status === "SUCCESS")
        ? "passed"
        : responses.some((r) => r.status === "ERROR")
          ? "error"
          : "failed";
    }
    const passed = responses.length === submission.total ? responses.filter((r) => r.status === "SUCCESS").length : 0;
    const done = await this.deps.store.submissions.complete(submission.id, {
      status,
      passed,
      total: submission.total,
      tests,
      judgedAt: this.now(),
    });
    if (!done || !item || done.mode !== "submit" || status !== "passed") return;
    const row = await this.deps.store.progress.get(done.userId, item.id);
    const xp = await this.solve(done.userId, item, row?.status ?? null);
    if (xp) await this.deps.store.submissions.setXp(done.id, xp);
  }

  private submissionView(s: SubmissionRecord): ArenaSubmissionView {
    return {
      id: s.id,
      itemId: s.itemId,
      mode: s.mode,
      status: s.status,
      passed: s.passed,
      total: s.total,
      tests: s.tests,
      xpGained: s.xpGained,
      createdAt: s.createdAt.toISOString(),
      judgedAt: s.judgedAt ? s.judgedAt.toISOString() : null,
    };
  }

  async getSubmission(userId: string, id: string): Promise<ArenaSubmissionView> {
    const s = await this.deps.store.submissions.get(id);
    // Same 404 for someone else's submission.
    if (!s || s.userId !== userId) throw new NotFoundError("Submission", id);
    return this.submissionView(s);
  }

  private summary = (s: SubmissionRecord): ArenaSubmissionSummary => ({
    id: s.id,
    itemId: s.itemId,
    itemTitle: this.catalog.item(s.itemId)?.title ?? "Removed item",
    mode: s.mode,
    status: s.status,
    passed: s.passed,
    total: s.total,
    createdAt: s.createdAt.toISOString(),
  });

  async listSubmissions(
    userId: string,
    query: { limit: number; cursor?: string; itemId?: string },
  ): Promise<Page<ArenaSubmissionSummary>> {
    const page = await this.deps.store.submissions.pageForUser(userId, query);
    return { items: page.items.map(this.summary), nextCursor: page.nextCursor };
  }

  /* ── Dashboard ── */

  async dashboard(userId: string): Promise<ArenaDashboard> {
    const [stats, progress, submitStats, recent] = await Promise.all([
      this.deps.store.stats.get(userId),
      this.progressMap(userId),
      this.deps.store.submissions.submitStats(userId),
      this.deps.store.submissions.pageForUser(userId, { limit: 8 }),
    ]);
    const today = dayOf(this.now());
    const days = stats?.days ?? {};
    const xp = stats?.xp ?? 0;

    const activity = Array.from({ length: ACTIVITY_DAYS }, (_, i) => {
      const day = addDays(today, i - ACTIVITY_DAYS + 1);
      return { day, solved: days[day] ?? 0 };
    });

    const startedTopics = this.catalog
      .topics()
      .filter((t) => t.items.some((i) => progress.has(i.id)))
      .map((t) => ({ id: t.id, title: t.title, trackId: t.trackId, mastery: this.mastery(t.items, progress).mastery }))
      .filter((t) => t.mastery < 1)
      .sort((a, b) => a.mastery - b.mastery)
      .slice(0, 3);

    const withTopic = (item: CatalogItem) => ({
      id: item.id,
      title: item.title,
      topicTitle: this.catalog.topic(item.topicId)!.title,
    });

    return {
      xp,
      ...levelForXp(xp),
      solvedCount: [...progress.values()].filter((p) => p.status === "solved").length,
      totalItems: this.catalog.items.length,
      submissionCount: submitStats.total,
      acceptanceRate: submitStats.total ? Math.round((submitStats.passed / submitStats.total) * 100) / 100 : null,
      streak: streaks(Object.keys(days), today),
      activity,
      tracks: this.catalog.tracks.map((t) => this.trackSummary(t, progress)),
      weakestTopics: startedTopics,
      continueItem: (() => {
        const item = this.continueItem(progress);
        return item ? withTopic(item) : null;
      })(),
      dailyItem: (() => {
        const item = this.dailyItem(today);
        return item
          ? { ...withTopic(item), difficulty: item.difficulty, status: progress.get(item.id)?.status ?? null }
          : null;
      })(),
      recentSubmissions: recent.items.map(this.summary),
    };
  }

  /** The unfinished item worked on most recently, else the next unsolved one. */
  private continueItem(progress: ProgressMap): CatalogItem | null {
    const rows = [...progress.values()].sort((a, b) => b.lastActivityAt.getTime() - a.lastActivityAt.getTime());
    const unfinished = rows.find((r) => r.status === "attempted" && this.catalog.item(r.itemId));
    if (unfinished) return this.catalog.item(unfinished.itemId)!;
    const last = rows.map((r) => this.catalog.item(r.itemId)).find(Boolean);
    const items = this.catalog.items;
    const start = last ? last.order + 1 : 0;
    return (
      items.slice(start).find((i) => progress.get(i.id)?.status !== "solved") ??
      items.find((i) => progress.get(i.id)?.status !== "solved") ??
      null
    );
  }

  /** Same item for everyone on a given day, from the free items. */
  dailyItem(day: string): CatalogItem | null {
    const pool = this.catalog.items.filter((i) => i.access === "free");
    if (!pool.length) return null;
    let h = 0;
    for (const ch of day) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return pool[h % pool.length]!;
  }
}
