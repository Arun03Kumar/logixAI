"use client";
import { itemHref } from "@/app/lib/areas";
import Link from "next/link";
import { useParams } from "next/navigation";
import { CalendarDays, Flame, Sparkles, Target, Trophy } from "lucide-react";
import { Card, Container, EmptyState, Skeleton, cn } from "@logixai/ui";
import AppHeader from "@/app/components/layout/AppHeader";
import { MasteryBar } from "@/app/arena/_components/bits";
import { arenaApi } from "@/app/lib/api/arena";
import { useApi } from "@/app/lib/api/useApi";
import { useNow } from "@/app/practice/_components/session";

const monthFmt = new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric" });
const dayFmt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short" });

function Stat({ icon: Icon, label, value }) {
  return (
    <Card className="flex items-center gap-3 p-4">
      <Icon className="size-5 text-primary" />
      <span>
        <span className="block text-xl font-semibold tabular-nums">{value}</span>
        <span className="block text-xs text-muted-foreground">{label}</span>
      </span>
    </Card>
  );
}

/** Twelve weeks of practice, one square per day (India time). */
function Activity({ activity }) {
  const now = useNow(60_000);
  const days = [];
  const today = new Date(now + 330 * 60_000);
  for (let i = 83; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 86_400_000).toISOString().slice(0, 10);
    days.push([d, activity[d]]);
  }
  return (
    <div className="grid w-max grid-flow-col grid-rows-7 gap-1" role="img" aria-label="Practice activity over the last 12 weeks">
      {days.map(([d, n]) => (
        <span
          key={d}
          title={`${d}: ${n === undefined ? "no practice" : `${n} solved`}`}
          className={cn(
            "size-3 rounded-sm",
            n === undefined ? "bg-muted" : n === 0 ? "bg-primary/30" : n < 3 ? "bg-primary/60" : "bg-primary",
          )}
        />
      ))}
    </div>
  );
}

export default function PublicProfilePage() {
  const { handle } = useParams();
  const profile = useApi(() => arenaApi.profile(handle), [handle]);
  const p = profile.data;
  return (
    <>
      <AppHeader />
      <main className="py-8">
        <Container size="md" className="space-y-6">
          {!p ? (
            profile.error ? (
              <EmptyState title="Profile not found" description="This profile doesn't exist or isn't public." />
            ) : (
              <Skeleton className="h-64" />
            )
          ) : (
            <>
              <div className="space-y-1">
                <h1 className="text-2xl font-semibold">{p.displayName}</h1>
                <p className="text-sm text-muted-foreground">
                  @{p.handle} · practising since {monthFmt.format(new Date(p.memberSince))}
                </p>
                {p.bio ? <p className="pt-2">{p.bio}</p> : null}
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat icon={Target} label="problems solved" value={p.solvedCount} />
                <Stat icon={Sparkles} label="XP" value={p.xp} />
                <Stat icon={Flame} label={`day streak (best ${p.streak.longest})`} value={p.streak.current} />
                <Stat icon={CalendarDays} label="mock interviews" value={p.mocksCompleted} />
              </div>
              <Card className="space-y-3 p-5">
                <h2 className="font-semibold">Activity</h2>
                <div className="overflow-x-auto">
                  <Activity activity={p.activity} />
                </div>
              </Card>
              <Card className="space-y-3 p-5">
                <h2 className="font-semibold">Tracks</h2>
                <ul className="space-y-3">
                  {p.tracks
                    .filter((t) => t.solved > 0)
                    .map((t) => (
                      <li key={t.id} className="space-y-1">
                        <div className="flex justify-between text-sm">
                          <Link href={`/arena/tracks/${t.id}`} className="hover:underline">
                            {t.title}
                          </Link>
                          <span className="font-mono tabular-nums text-muted-foreground">
                            {t.solved}/{t.total}
                          </span>
                        </div>
                        <MasteryBar value={t.solved / t.total} label="Solved" />
                      </li>
                    ))}
                  {!p.tracks.some((t) => t.solved > 0) ? <li className="text-sm text-muted-foreground">Nothing solved yet.</li> : null}
                </ul>
              </Card>
              {p.contests.length ? (
                <Card className="space-y-3 p-5">
                  <h2 className="flex items-center gap-2 font-semibold">
                    <Trophy className="size-4" />
                    Contests
                  </h2>
                  <ul className="divide-y divide-border">
                    {p.contests.map((c) => (
                      <li key={c.id} className="flex justify-between py-2 text-sm">
                        <Link href={`/practice/contests/${c.id}`} className="hover:underline">
                          {c.title}
                        </Link>
                        <span className="font-mono tabular-nums">
                          #{c.rank} of {c.participants} · {c.points} pts
                        </span>
                      </li>
                    ))}
                  </ul>
                </Card>
              ) : null}
              {p.recent.length ? (
                <Card className="space-y-3 p-5">
                  <h2 className="font-semibold">Recently solved</h2>
                  <ul className="divide-y divide-border">
                    {p.recent.map((r) => (
                      <li key={r.itemId} className="flex justify-between py-2 text-sm">
                        <Link href={itemHref(r.area, r.itemId)} className="hover:underline">
                          {r.title}
                        </Link>
                        <span className="text-muted-foreground">{dayFmt.format(new Date(r.solvedAt))}</span>
                      </li>
                    ))}
                  </ul>
                </Card>
              ) : null}
            </>
          )}
        </Container>
      </main>
    </>
  );
}
