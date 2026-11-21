import {
  FREE_DAILY_CODE_RUNS,
  LOWER_IS_BETTER,
  XP_BY_DIFFICULTY,
  type Checker,
  type ReviewQueue,
  type SkillMap,
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
  type ProblemList,
  type ProblemListSummary,
  type ProblemQuery,
  type ProblemRow,
  type TablePreview,
  type TopicDetail,
  type TopicSummary,
  type TrackDetail,
  type TrackSummary,
} from "@logixai/contracts";
import { BadRequestError, ConflictError, ForbiddenError, InternalServerError, NotFoundError } from "@logixai/service-kit";
import { jsHarnessFor, type Catalog, type CatalogItem, type CatalogTopic, type CatalogTrack } from "../content/catalog.js";
import { buildJudgeProgram, buildSqlJudgeProgram, formatCall } from "../content/harness.js";
import { buildJsJudgeProgram, formatJsCall } from "../content/harnessJs.js";
import { addDays, dayOf, streaks } from "../lib/days.js";
import type { Page, ProgressRecord, Store, SubmissionRecord } from "../store/types.js";
import {
  firstReview,
  isDue,
  nextReview,
  recommendations,
  reviewQueue,
  reviewState,
  skillMap,
} from "./learning.js";

export interface JudgeRequest {
  submissionId: string;
  userId: string;
  program: string;
  /** Judge runtime: PYTHON_ML, or NODE_WEB for JavaScript / React items. */
  language: "PYTHON_ML" | "NODE_WEB";
  tests: { input: string; output: string }[];
  /** json with the item's tolerance, or metric for dataset challenges. */
  checker: Checker;
}

export interface JudgeGateway {
  submit(request: JudgeRequest): Promise<void>;
}

export interface Deps {
  catalog: Catalog;
  store: Store;
  judge: JudgeGateway;
  now?: () => Date;
  /** Told about every graded answer and submit (mock interviews and contests record them). */
  onOutcome?: (userId: string, itemId: string, event: "correct" | "wrong", at: Date) => Promise<void>;
}

/** A learner may have one run waiting for the judge at a time (stale after this). */
const PENDING_WINDOW_MS = 60_000;
/** design items: the shortest write-up that counts as an attempt. */
const DESIGN_MIN_CHARS = 200;
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

  /** What one test of a judged item looks like to the learner. */
  private sampleCall(item: CatalogItem, args: unknown[], index: number): string {
    if (item.type === "sql") return `Sample data ${index + 1}`;
    if (!("function" in item)) return "";
    return item.language === "javascript" ? formatJsCall(item.function.name, args) : formatCall(item.function.name, args);
  }

  /** The tables in one test: SQL tables, or a function's DataFrame arguments. */
  private sampleTables(item: CatalogItem, args: unknown[]): TablePreview[] | undefined {
    if (item.type === "sql") {
      const data = (args[0] ?? {}) as Record<string, unknown[][]>;
      return item.tables.map((t) => ({ name: t.name, columns: t.columns.map((c) => c[0]), rows: data[t.name] ?? [] }));
    }
    if (!("function" in item)) return undefined;
    const tables = item.function.params.flatMap((p, i): TablePreview[] => {
      const v = args[i] as { columns?: unknown; data?: unknown } | undefined;
      if (p.type !== "dataframe" || !v || !Array.isArray(v.columns) || !Array.isArray(v.data)) return [];
      return [{ name: p.name, columns: v.columns.map(String), rows: v.data as unknown[][] }];
    });
    return tables.length ? tables : undefined;
  }

  /* ── Problem list and curated lists ── */

  async problems(userId: string | null, query: ProblemQuery): Promise<ProblemList> {
    const progress = await this.progressMap(userId);
    const list = query.list ? this.catalog.list(query.list) : undefined;
    if (query.list && !list) throw new NotFoundError("List", query.list);
    const needle = query.q?.toLowerCase();
    let items = list ? list.items.map((id) => this.catalog.item(id)!) : this.catalog.items;
    items = items.filter((i) => {
      const status = progress.get(i.id)?.status ?? null;
      if (query.type && i.type !== query.type) return false;
      if (query.difficulty && i.difficulty !== query.difficulty) return false;
      if (query.access && i.access !== query.access) return false;
      if (query.track && i.trackId !== query.track) return false;
      if (query.tag && !i.tags.includes(query.tag)) return false;
      if (query.status === "solved" && status !== "solved") return false;
      if (query.status === "attempted" && status !== "attempted") return false;
      if (query.status === "todo" && status === "solved") return false;
      if (needle && !i.title.toLowerCase().includes(needle) && !i.tags.some((t) => t.includes(needle))) return false;
      return true;
    });
    const tagCounts = new Map<string, number>();
    for (const i of items) for (const t of i.tags) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
    const rows = items.map((i): ProblemRow => {
      const topic = this.catalog.topic(i.topicId)!;
      const track = this.catalog.track(i.trackId)!;
      return {
        ...this.itemSummary(i, progress),
        tags: i.tags,
        topic: { id: topic.id, title: topic.title },
        track: { id: track.id, title: track.title },
      };
    });
    return {
      items: rows,
      total: rows.length,
      solved: rows.filter((r) => r.status === "solved").length,
      tags: [...tagCounts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([tag, count]) => ({ tag, count })),
    };
  }

  async lists(userId: string | null): Promise<ProblemListSummary[]> {
    const progress = await this.progressMap(userId);
    return this.catalog.lists.map((l) => ({
      id: l.id,
      title: l.title,
      summary: l.summary,
      itemCount: l.items.length,
      solvedCount: l.items.filter((id) => progress.get(id)?.status === "solved").length,
    }));
  }

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
      case "design":
        view.passShare = item.passShare;
        // The rubric comes after the learner's own attempt, so it can't be copied up front.
        if (row) Object.assign(view, this.designDetails(item));
        break;
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
        view.language = item.language;
        if (open) view.answer = item.answer;
        break;
      case "sql":
        view.starterCode = item.starter;
        view.sqlTables = item.tables.map((t) => ({ name: t.name, columns: t.columns }));
        view.ordered = item.ordered;
        view.samples = (item.judge?.sample ?? []).map((t, i) => ({
          call: this.sampleCall(item, t.args, i),
          expected: t.expected,
          tables: this.sampleTables(item, t.args)!,
        }));
        view.hiddenTestCount = item.judge?.hidden.length ?? 0;
        if (open) view.solution = item.solution;
        break;
      case "code":
      case "debug":
        view.starterCode = item.starter;
        view.signature = { name: item.function.name, params: item.function.params, returns: item.function.returns };
        if (item.driver) view.driver = item.driver;
        view.language = item.language;
        if (item.preview) view.preview = item.preview;
        if (item.visual) view.visual = item.visual;
        view.samples = (item.judge?.sample ?? []).map((t, i) => {
          const tables = item.dataset ? undefined : this.sampleTables(item, t.args);
          return {
            call: this.sampleCall(item, t.args, i),
            expected: this.expectedText(item, t.expected),
            ...(tables ? { tables } : {}),
          };
        });
        view.hiddenTestCount = item.judge?.hidden.length ?? 0;
        if (item.scoring) view.scoring = item.scoring;
        if (item.dataset && item.datasetPreview) view.dataset = { target: item.dataset.target, ...item.datasetPreview };
        if (open) view.solution = item.solution;
        break;
    }
    if (open) view.explanation = item.explanation;
    const review = reviewState(row?.userId ? row : null, this.now());
    if (review) view.review = review;
    return view;
  }

  /** Dataset challenges never show the labels, only what score is needed. */
  private expectedText(item: CatalogItem, expected: string): string {
    if (!("scoring" in item) || !item.scoring) return expected;
    const { metric, threshold } = item.scoring;
    return `${metric} ${LOWER_IS_BETTER[metric] ? "≤" : "≥"} ${threshold}`;
  }

  /** Pro items need Pro: `pro` comes from the caller's access token. */
  private isLocked(item: CatalogItem, pro: boolean) {
    return item.access === "pro" && !pro;
  }

  private requireAccess(item: CatalogItem, pro: boolean) {
    if (this.isLocked(item, pro)) throw new ForbiddenError("This is a Pro problem. Upgrade to Pro to solve it.");
  }

  /** What a free user sees of a Pro item: enough to know what it is, not to solve it. */
  private lockedView(item: CatalogItem): ItemView {
    const full = this.itemView(item, null);
    return {
      id: full.id,
      title: full.title,
      type: full.type,
      difficulty: full.difficulty,
      access: full.access,
      status: null,
      locked: true,
      topic: full.topic,
      trackId: full.trackId,
      tags: full.tags,
      prompt: full.prompt,
      hints: [],
      previousItem: full.previousItem,
      nextItem: full.nextItem,
    };
  }

  async getItem(userId: string | null, itemId: string, pro = false): Promise<ItemView> {
    const item = this.mustItem(itemId);
    if (this.isLocked(item, pro)) return this.lockedView(item);
    const row = userId ? await this.deps.store.progress.get(userId, itemId) : null;
    return this.itemView(item, row);
  }

  /** Gives up on an item: shows the answer and explanation. Solving it later earns no XP. */
  async reveal(userId: string, itemId: string, pro = false): Promise<ItemView> {
    const item = this.mustItem(itemId);
    this.requireAccess(item, pro);
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
      case "design": {
        if (!("text" in input) || input.text.trim().length < DESIGN_MIN_CHARS) {
          throw new BadRequestError("answer", { reason: `Write your design first (at least ${DESIGN_MIN_CHARS} characters).` });
        }
        if (!input.checked) return false; // first submission: show the rubric
        const ids = new Set(item.rubric.map((r) => r.id));
        const covered = new Set(input.checked.filter((id) => ids.has(id)));
        return covered.size >= Math.ceil(item.passShare * item.rubric.length);
      }
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
    if (firstSolve) await this.deps.store.progress.setReview(userId, item.id, firstReview(this.now()));
    await this.deps.store.stats.record(userId, dayOf(this.now()), { xp: gained, solved: firstSolve ? 1 : 0 });
    return gained;
  }

  /** A solved item answered again while due counts as a review: success spaces it out, a miss starts over. */
  private async review(row: ProgressRecord | null, success: boolean): Promise<boolean> {
    if (!row || !isDue(row, this.now())) return false;
    await this.deps.store.progress.setReview(row.userId, row.itemId, nextReview(row.review!, success, this.now()));
    return true;
  }

  async answer(userId: string, itemId: string, input: AnswerInput, pro = false): Promise<AnswerResult> {
    const item = this.mustItem(itemId);
    this.requireAccess(item, pro);
    const correct = this.grade(item, input);
    const row = await this.deps.store.progress.recordAttempt(userId, itemId, input, this.now());
    const design = item.type === "design" ? this.designDetails(item) : {};
    // A design draft (no self-check yet) isn't a wrong answer or a failed review.
    const draft = item.type === "design" && "text" in input && !input.checked;
    if (!draft) await this.deps.onOutcome?.(userId, itemId, correct ? "correct" : "wrong", this.now());
    if (!correct) {
      await this.deps.store.stats.record(userId, dayOf(this.now()), { xp: 0, solved: 0 });
      const reviewed = draft ? false : await this.review(row, false);
      const open = row.status === "solved" || row.status === "revealed";
      return {
        correct: false,
        status: row.status,
        xpGained: 0,
        ...(reviewed ? { reviewed } : {}),
        ...(open ? this.answerDetails(item) : {}),
        ...design,
      };
    }
    const reviewed = await this.review(row, true);
    const xpGained = await this.solve(userId, item, row.status);
    return { correct: true, status: "solved", xpGained, ...(reviewed ? { reviewed } : {}), ...this.answerDetails(item), ...design };
  }

  private designDetails(item: Extract<CatalogItem, { type: "design" }>): Pick<AnswerResult, "rubric" | "modelAnswer" | "explanation"> {
    return {
      rubric: item.rubric.map((r) => ({ id: r.id, point: r.point, ...(r.detail ? { detail: r.detail } : {}) })),
      modelAnswer: item.modelAnswer,
      explanation: item.explanation,
    };
  }

  private answerDetails(item: CatalogItem): Pick<AnswerResult, "explanation" | "answer"> {
    const view = this.itemView(item, { status: "solved" } as ProgressRecord);
    return { explanation: item.explanation, ...(view.answer !== undefined ? { answer: view.answer } : {}) };
  }

  /* ── Code ── */

  async runCode(userId: string, itemId: string, input: CodeRunInput, pro = false): Promise<ArenaSubmissionView> {
    const item = this.mustItem(itemId);
    this.requireAccess(item, pro);
    if (!isCodeItem(item.type) || !(item.type === "sql" || "function" in item)) {
      throw new BadRequestError("item", { reason: "This item takes an answer, not code." });
    }
    if (!item.judge) throw new InternalServerError({ reason: `Tests for ${item.id} haven't been built` });
    const now = this.now();
    if (!pro) {
      // India-time day, like streaks.
      const dayStart = new Date(`${dayOf(now)}T00:00:00+05:30`);
      if ((await this.deps.store.submissions.countSince(userId, dayStart)) >= FREE_DAILY_CODE_RUNS) {
        throw new ForbiddenError(
          `You've used today's ${FREE_DAILY_CODE_RUNS} free code runs. Pro has no daily limit — or come back tomorrow.`,
        );
      }
    }
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
        language: item.type !== "sql" && item.language === "javascript" ? "NODE_WEB" : "PYTHON_ML",
        program:
          item.type === "sql"
            ? buildSqlJudgeProgram({ tables: item.tables, ordered: item.ordered }, input.code)
            : item.language === "javascript"
              ? buildJsJudgeProgram(jsHarnessFor(item), input.code)
              : buildJudgeProgram(item.function, input.code, item.driver),
        tests: tests.map((t) => ({ input: JSON.stringify({ args: t.args }), output: t.expected })),
        checker:
          item.type !== "sql" && item.scoring
            ? { kind: "metric", metric: item.scoring.metric, threshold: item.scoring.threshold }
            : { kind: "json", absTol: item.tolerance.abs, relTol: item.tolerance.rel },
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
          call: this.sampleCall(item!, t.args, index),
          expected: this.expectedText(item!, t.expected),
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
    if (!done || !item || done.mode !== "submit") return;
    // Judge errors (our side) don't count against the learner.
    if (status !== "error") await this.deps.onOutcome?.(done.userId, item.id, status === "passed" ? "correct" : "wrong", this.now());
    const row = await this.deps.store.progress.get(done.userId, item.id);
    // A submit on a solved, due item is its review; judge errors don't count.
    if (status !== "error") await this.review(row, status === "passed");
    if (status !== "passed") return;
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
      recommendations: recommendations(this.catalog, progress, this.now(), this.continueItem(progress)),
      reviewDueCount: [...progress.values()].filter((r) => isDue(r, this.now()) && this.catalog.item(r.itemId)).length,
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

  async reviewQueue(userId: string): Promise<ReviewQueue> {
    return reviewQueue(this.catalog, await this.progressMap(userId), this.now());
  }

  async skillMap(userId: string | null): Promise<SkillMap> {
    return skillMap(this.catalog, await this.progressMap(userId));
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
