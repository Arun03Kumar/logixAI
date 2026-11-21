/**
 * Mock interviews, contests and public profiles (ML Arena / Practice).
 */
import { z } from "zod";
import type { ArenaDifficulty, ArenaItemType, Area } from "./arena";

/* ── Timed sessions (mock interviews and contests) ── */

export type SessionKind = "mock" | "contest";

/** One question in a session, with how the learner did on it so far. */
export interface SessionItemView {
  id: string;
  area: Area;
  title: string;
  type: ArenaItemType;
  difficulty: ArenaDifficulty;
  topicTitle: string;
  trackTitle: string;
  solved: boolean;
  /** Minutes from the session (or contest) start to the solve. */
  solvedAfterMin: number | null;
  /** Wrong answers / failed submits before solving. */
  wrongAttempts: number;
}

export interface SessionReport {
  /** Difficulty-weighted share of points earned, 0–1. */
  score: number;
  solved: number;
  total: number;
  verdict: "strong" | "borderline" | "needs-work";
  /** Topics with a missed question, worth practising next. */
  practiceNext: { topicId: string; topicTitle: string }[];
}

export interface SessionView {
  id: string;
  kind: SessionKind;
  title: string;
  /** mock: the template; contest: the contest id. */
  sourceId: string;
  startedAt: string;
  endsAt: string;
  finishedAt: string | null;
  /** true once time is up or the learner ended it. */
  over: boolean;
  /** Contests: false for virtual participation after the contest ended. */
  ranked: boolean;
  items: SessionItemView[];
  /** Contests: points and penalty minutes (LeetCode-style). */
  points?: number;
  penaltyMin?: number;
  report?: SessionReport;
}

export interface SessionSummary {
  id: string;
  kind: SessionKind;
  title: string;
  sourceId: string;
  startedAt: string;
  over: boolean;
  solved: number;
  total: number;
  score: number;
}

export interface MockTemplateView {
  id: string;
  area: Area;
  title: string;
  summary: string;
  durationMin: number;
  questionCount: number;
  /** e.g. ["2 SQL", "1 Pandas", "2 quiz"] */
  outline: string[];
}

export interface MockHub {
  templates: MockTemplateView[];
  active: SessionSummary | null;
  history: SessionSummary[];
  /** Free plan: mock interviews left this week (null = unlimited). */
  remainingThisWeek: number | null;
}

export const StartMockSchema = z.object({ templateId: z.string().min(1).max(100) });
export type StartMockInput = z.infer<typeof StartMockSchema>;

/* ── Contests ── */

export type ContestStatus = "upcoming" | "live" | "ended";

export interface ContestSummary {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  status: ContestStatus;
  questionCount: number;
  participants: number;
}

export interface LeaderboardRow {
  rank: number;
  name: string;
  /** Public profile handle, when the participant has one. */
  handle: string | null;
  points: number;
  penaltyMin: number;
  solved: number;
  me: boolean;
}

export interface ContestView extends ContestSummary {
  rules: string;
  /** Hidden until the contest starts. */
  items: { id: string; area: Area; title: string; type: ArenaItemType; difficulty: ArenaDifficulty; points: number }[] | null;
  leaderboard: LeaderboardRow[];
  myRow: LeaderboardRow | null;
  mySession: SessionSummary | null;
}

/* ── Public profiles ── */

export const HANDLE_PATTERN = /^[a-z0-9_]{3,20}$/;

export const ProfileInputSchema = z.object({
  handle: z.string().trim().toLowerCase().regex(HANDLE_PATTERN, "3–20 lowercase letters, digits or underscores"),
  displayName: z.string().trim().min(1).max(60),
  bio: z.string().trim().max(280).default(""),
  public: z.boolean(),
});
export type ProfileInput = z.infer<typeof ProfileInputSchema>;

export interface ProfileSettings extends ProfileInput {
  /** Where the public page lives (shown when public). */
  url: string;
  /** false until the learner saves a profile (fields are suggestions). */
  saved: boolean;
}

export interface PublicProfile {
  handle: string;
  displayName: string;
  bio: string;
  memberSince: string;
  xp: number;
  solvedCount: number;
  streak: { current: number; longest: number };
  /** Days with practice in the last 12 weeks: "YYYY-MM-DD" -> items solved. */
  activity: Record<string, number>;
  tracks: { id: string; title: string; solved: number; total: number }[];
  recent: { itemId: string; area: Area; title: string; solvedAt: string }[];
  contests: { id: string; title: string; rank: number; participants: number; points: number }[];
  mocksCompleted: number;
}
