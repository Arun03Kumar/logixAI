import { z } from "zod";

/**
 * ML Arena: practice for maths, Python/NumPy and machine learning.
 *
 * These are the public API shapes. Answers, reference solutions and hidden
 * tests live only in arena-service and are never part of these types, except
 * `solution` / `explanation`, which are sent once an item is solved or revealed.
 */

export const ARENA_ITEM_TYPES = [
  /** One correct option. */
  "mcq_single",
  /** Several correct options; all must be picked. */
  "mcq_multi",
  /** A number, checked within a tolerance. */
  "numeric",
  /** Predict what a code snippet prints. */
  "output",
  /** Implement a function; judged against sample and hidden tests. */
  "code",
  /** Fix a broken implementation; judged like `code`. */
  "debug",
] as const;
export type ArenaItemType = (typeof ARENA_ITEM_TYPES)[number];
export const isCodeItem = (type: ArenaItemType) => type === "code" || type === "debug";

export const ARENA_DIFFICULTIES = ["easy", "medium", "hard", "expert"] as const;
export type ArenaDifficulty = (typeof ARENA_DIFFICULTIES)[number];

/** Free items are open to everyone; pro items will need a subscription. */
export const ACCESS_LEVELS = ["free", "pro"] as const;
export type AccessLevel = (typeof ACCESS_LEVELS)[number];

export const TRACK_LEVELS = ["foundations", "core", "interview"] as const;
export type TrackLevel = (typeof TRACK_LEVELS)[number];

/** Experience points for a first solve, by difficulty. Revealing first gives none. */
export const XP_BY_DIFFICULTY: Record<ArenaDifficulty, number> = {
  easy: 10,
  medium: 20,
  hard: 40,
  expert: 80,
};

/** Level n needs 50·n·(n-1) XP: 0, 100, 300, 600, 1000, ... */
export function levelForXp(xp: number): { level: number; levelXp: number; nextLevelXp: number } {
  let level = 1;
  while (50 * (level + 1) * level <= xp) level += 1;
  return { level, levelXp: 50 * level * (level - 1), nextLevelXp: 50 * (level + 1) * level };
}

export type ItemStatus = "solved" | "attempted" | "revealed";

export interface ItemSummary {
  id: string;
  title: string;
  type: ArenaItemType;
  difficulty: ArenaDifficulty;
  access: AccessLevel;
  /** Signed-in user's progress; null when not started or signed out. */
  status: ItemStatus | null;
}

export interface TopicRef {
  id: string;
  title: string;
}

export interface TopicSummary {
  id: string;
  title: string;
  summary: string;
  prerequisites: TopicRef[];
  itemCount: number;
  solvedCount: number;
  /** 0..1, difficulty-weighted share of the topic's items solved. */
  mastery: number;
}

export interface TrackSummary {
  id: string;
  title: string;
  summary: string;
  level: TrackLevel;
  topicCount: number;
  itemCount: number;
  solvedCount: number;
  mastery: number;
}

export interface TrackDetail extends TrackSummary {
  topics: TopicSummary[];
}

export interface TopicDetail extends TopicSummary {
  trackId: string;
  trackTitle: string;
  /** Markdown with $inline$ and $$block$$ maths. */
  lesson: string;
  items: ItemSummary[];
  previousTopic: TopicRef | null;
  nextTopic: TopicRef | null;
}

export interface FunctionSignature {
  name: string;
  params: { name: string; type: string }[];
  returns: string;
}

export interface SampleTest {
  /** Python-style call, e.g. `dot([1, 2], [3, 4])`. */
  call: string;
  /** Expected return value as JSON. */
  expected: string;
}

export interface ItemView extends ItemSummary {
  topic: TopicRef;
  trackId: string;
  tags: string[];
  /** Markdown. */
  prompt: string;
  hints: string[];
  /** mcq_single / mcq_multi */
  options?: { id: string; text: string }[];
  /** output: the snippet whose output is asked for. */
  snippet?: string;
  /** numeric: e.g. "rounded to 2 decimals". */
  answerFormat?: string;
  /** code / debug */
  starterCode?: string;
  signature?: FunctionSignature;
  samples?: SampleTest[];
  hiddenTestCount?: number;
  /** Shown once solved or revealed. */
  explanation?: string;
  solution?: string;
  /** mcq: correct option ids; numeric/output: the answer. Only once solved or revealed. */
  answer?: string[] | string;
  /** The signed-in user's last answer or code, to restore the page. */
  lastAnswer?: unknown;
  previousItem: TopicRef | null;
  nextItem: TopicRef | null;
}

/* ── Answering (mcq, numeric, output) ── */

export const AnswerInputSchema = z.union([
  z.object({ selectedOptionIds: z.array(z.string().min(1).max(50)).min(1).max(20) }),
  z.object({ value: z.number().finite() }),
  z.object({ text: z.string().max(5000) }),
]);
export type AnswerInput = z.infer<typeof AnswerInputSchema>;

export interface AnswerResult {
  correct: boolean;
  status: ItemStatus;
  xpGained: number;
  /** Present when correct (or when the item was already revealed). */
  explanation?: string;
  answer?: string[] | string;
}

/* ── Code items ── */

export const CodeRunInputSchema = z.object({
  code: z.string().min(1).max(50_000),
  /** run = sample tests only; submit = sample + hidden tests. */
  mode: z.enum(["run", "submit"]),
});
export type CodeRunInput = z.infer<typeof CodeRunInputSchema>;

export type ArenaSubmissionStatus = "pending" | "passed" | "failed" | "error";

export interface ArenaTestResult {
  index: number;
  sample: boolean;
  /** Judge verdict: SUCCESS, WA, TLE, MLE, RE, CE, ERROR. */
  verdict: string;
  timeMs?: number;
  /** Sample tests only. */
  call?: string;
  expected?: string;
  output?: string;
  /** Error text (tracebacks, compile errors). */
  message?: string;
}

export interface ArenaSubmissionView {
  id: string;
  itemId: string;
  mode: "run" | "submit";
  status: ArenaSubmissionStatus;
  passed: number;
  total: number;
  tests: ArenaTestResult[];
  xpGained: number;
  createdAt: string;
  judgedAt: string | null;
}

export interface ArenaSubmissionSummary {
  id: string;
  itemId: string;
  itemTitle: string;
  mode: "run" | "submit";
  status: ArenaSubmissionStatus;
  passed: number;
  total: number;
  createdAt: string;
}

/* ── Progress ── */

export interface ArenaDashboard {
  xp: number;
  level: number;
  levelXp: number;
  nextLevelXp: number;
  solvedCount: number;
  totalItems: number;
  /** Code submissions (mode "submit") and their pass rate. */
  submissionCount: number;
  acceptanceRate: number | null;
  streak: { current: number; longest: number; activeToday: boolean };
  /** Last 84 days, oldest first: items solved per day (Asia/Kolkata days). */
  activity: { day: string; solved: number }[];
  tracks: TrackSummary[];
  /** Started topics with the lowest mastery. */
  weakestTopics: (TopicRef & { trackId: string; mastery: number })[];
  continueItem: (TopicRef & { topicTitle: string }) | null;
  dailyItem: (TopicRef & { topicTitle: string; difficulty: ArenaDifficulty; status: ItemStatus | null }) | null;
  recentSubmissions: ArenaSubmissionSummary[];
}
