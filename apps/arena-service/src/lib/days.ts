/** Practice days are counted in India time (UTC+5:30), where most learners are. */
const IST_OFFSET_MS = 330 * 60_000;

/** "YYYY-MM-DD" for the India-time day containing `at`. */
export function dayOf(at: Date): string {
  return new Date(at.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Streaks from the set of practiced days. The current streak still counts if
 * the learner hasn't practiced yet today but did yesterday.
 */
export function streaks(days: Iterable<string>, today: string): { current: number; longest: number; activeToday: boolean } {
  const set = new Set(days);
  const activeToday = set.has(today);
  let current = 0;
  for (let d = activeToday ? today : addDays(today, -1); set.has(d); d = addDays(d, -1)) current += 1;

  let longest = 0;
  for (const d of set) {
    if (set.has(addDays(d, -1))) continue; // not the start of a run
    let len = 0;
    for (let x = d; set.has(x); x = addDays(x, 1)) len += 1;
    longest = Math.max(longest, len);
  }
  return { current, longest, activeToday };
}
