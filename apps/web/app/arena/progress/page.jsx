"use client";
import Link from "next/link";
import { Card, Container, EmptyState, PageHeader, Skeleton, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, cn } from "@logixai/ui";
import RequireAuth from "@/app/components/layout/RequireAuth";
import { arenaApi } from "@/app/lib/api/arena";
import { useApi } from "@/app/lib/api/useApi";
import ArenaShell from "../_components/ArenaShell";
import { MasteryBar, Stat } from "../_components/bits";
import { pct } from "../_components/labels";

const SUBMISSION_STATUS = {
  pending: { label: "Judging", className: "text-muted-foreground" },
  passed: { label: "Passed", className: "text-success" },
  failed: { label: "Failed", className: "text-danger" },
  error: { label: "Judge error", className: "text-warning" },
};

const shortDate = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short" });
const dateTime = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

function heat(solved) {
  if (!solved) return "bg-muted";
  if (solved === 1) return "bg-primary/30";
  if (solved <= 3) return "bg-primary/60";
  return "bg-primary";
}

/** 12 weeks of practice, one square per day (oldest top-left). */
function ActivityGrid({ activity }) {
  const weeks = [];
  for (let i = 0; i < activity.length; i += 7) weeks.push(activity.slice(i, i + 7));
  return (
    <div className="space-y-2">
      <div className="flex gap-1 overflow-x-auto" role="img" aria-label="Problems solved per day over the last 12 weeks">
        {weeks.map((week, w) => (
          <div key={w} className="grid shrink-0 gap-1">
            {week.map((d) => (
              <span
                key={d.day}
                className={cn("size-3.5 rounded-sm", heat(d.solved))}
                title={`${shortDate.format(new Date(`${d.day}T00:00:00`))}: ${d.solved} solved`}
              />
            ))}
          </div>
        ))}
      </div>
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        Less
        {[0, 1, 2, 4].map((n) => (
          <span key={n} className={cn("size-3 rounded-sm", heat(n))} />
        ))}
        More
      </p>
    </div>
  );
}

function Dashboard() {
  const dash = useApi(() => arenaApi.dashboard("ml"), []);
  if (dash.loading) {
    return (
      <div className="grid gap-3 sm:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-20" />
        ))}
      </div>
    );
  }
  if (dash.error) return <EmptyState title="Couldn't load your progress" description={dash.error.message} />;
  const d = dash.data;
  const levelProgress = (d.xp - d.levelXp) / (d.nextLevelXp - d.levelXp);

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-border bg-card px-4 py-3">
          <p className="text-xs text-muted-foreground">Level {d.level}</p>
          <p className="mt-1 text-xl font-semibold tabular-nums">{d.xp} XP</p>
          <MasteryBar value={levelProgress} label="Progress to next level" className="mt-2" />
          <p className="mt-1 text-xs text-muted-foreground">{d.nextLevelXp - d.xp} XP to level {d.level + 1}</p>
        </div>
        <Stat label="Problems solved" value={`${d.solvedCount} / ${d.totalItems}`} />
        <Stat
          label="Streak"
          value={`${d.streak.current} ${d.streak.current === 1 ? "day" : "days"}`}
          hint={`Longest: ${d.streak.longest} · ${d.streak.activeToday ? "practised today" : "not yet today"}`}
        />
        <Stat
          label="Code acceptance"
          value={d.acceptanceRate === null ? "—" : pct(d.acceptanceRate)}
          hint={`${d.submissionCount} code ${d.submissionCount === 1 ? "submission" : "submissions"}`}
        />
      </div>

      <Card className="space-y-3 p-5">
        <h2 className="font-semibold">Activity</h2>
        <ActivityGrid activity={d.activity} />
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="space-y-4 p-5">
          <h2 className="font-semibold">Mastery by track</h2>
          {d.tracks.map((t) => (
            <div key={t.id} className="space-y-1">
              <div className="flex justify-between text-sm">
                <Link href={`/arena/tracks/${t.id}`} className="font-medium hover:text-primary">
                  {t.title}
                </Link>
                <span className="text-muted-foreground">
                  {t.solvedCount} / {t.itemCount}
                </span>
              </div>
              <MasteryBar value={t.mastery} />
            </div>
          ))}
        </Card>
        <Card className="space-y-4 p-5">
          <h2 className="font-semibold">Work on next</h2>
          {d.weakestTopics.length ? (
            <ul className="space-y-3">
              {d.weakestTopics.map((t) => (
                <li key={t.id} className="space-y-1">
                  <Link href={`/arena/topics/${t.id}`} className="text-sm font-medium hover:text-primary">
                    {t.title}
                  </Link>
                  <MasteryBar value={t.mastery} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">Topics you&apos;ve started but not finished show up here.</p>
          )}
        </Card>
      </div>

      <Card className="overflow-hidden">
        <div className="px-5 py-4">
          <h2 className="font-semibold">Recent code runs</h2>
        </div>
        {d.recentSubmissions.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Problem</TableHead>
                <TableHead>Mode</TableHead>
                <TableHead>Result</TableHead>
                <TableHead>When</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {d.recentSubmissions.map((s) => (
                <TableRow key={s.id}>
                  <TableCell>
                    <Link href={`/arena/items/${s.itemId}`} className="font-medium hover:text-primary">
                      {s.itemTitle}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{s.mode === "submit" ? "Submit" : "Run"}</TableCell>
                  <TableCell className={SUBMISSION_STATUS[s.status].className}>
                    {SUBMISSION_STATUS[s.status].label}
                    {s.status !== "pending" && s.total ? ` · ${s.passed}/${s.total}` : ""}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {dateTime.format(new Date(s.createdAt))}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="px-5 pb-5 text-sm text-muted-foreground">No code runs yet.</p>
        )}
      </Card>
    </div>
  );
}

export default function ArenaProgressPage() {
  return (
    <ArenaShell>
      <Container size="xl" className="space-y-6">
        <PageHeader title="My progress" description="XP counts only work that passed a check. Mastery is weighted by difficulty." />
        <RequireAuth>
          <Dashboard />
        </RequireAuth>
      </Container>
    </ArenaShell>
  );
}
