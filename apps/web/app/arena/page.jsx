"use client";
import Link from "next/link";
import { ArrowRight, CalendarDays, FlaskConical, Flame, PlayCircle } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  Container,
  DifficultyBadge,
  EmptyState,
  PageHeader,
  Skeleton,
} from "@logixai/ui";
import { arenaApi } from "@/app/lib/api/arena";
import { useApi } from "@/app/lib/api/useApi";
import { useSession } from "@/app/lib/auth/useSession";
import ArenaShell from "./_components/ArenaShell";
import { MasteryBar, StatusIcon } from "./_components/bits";
import { Assigned, Recommendations } from "./_components/ForYou";
import { LABS, TRACK_LEVEL } from "./_components/labels";

function NextUp({ dashboard }) {
  const { continueItem, dailyItem, streak, xp, level } = dashboard;
  return (
    <div className="grid gap-3 md:grid-cols-3">
      <Card className="flex flex-col gap-3 p-5 md:col-span-1">
        <p className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <PlayCircle className="size-4" />
          Continue learning
        </p>
        {continueItem ? (
          <>
            <div>
              <p className="font-semibold">{continueItem.title}</p>
              <p className="text-sm text-muted-foreground">{continueItem.topicTitle}</p>
            </div>
            <Button asChild variant="primary" size="sm" className="mt-auto self-start">
              <Link href={`/arena/items/${continueItem.id}`}>
                Continue
                <ArrowRight />
              </Link>
            </Button>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">You&apos;ve solved everything here. New items are on the way.</p>
        )}
      </Card>
      {dailyItem ? (
        <Card className="flex flex-col gap-3 p-5">
          <p className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <CalendarDays className="size-4" />
            Today&apos;s challenge
          </p>
          <div>
            <p className="flex items-center gap-2 font-semibold">
              <StatusIcon status={dailyItem.status} />
              {dailyItem.title}
            </p>
            <p className="text-sm text-muted-foreground">{dailyItem.topicTitle}</p>
          </div>
          <div className="mt-auto flex items-center justify-between">
            <DifficultyBadge difficulty={dailyItem.difficulty} />
            <Button asChild size="sm">
              <Link href={`/arena/items/${dailyItem.id}`}>Open</Link>
            </Button>
          </div>
        </Card>
      ) : null}
      <Card className="flex flex-col gap-3 p-5">
        <p className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <Flame className="size-4" />
          Your streak
        </p>
        <p className="text-2xl font-semibold tabular-nums">
          {streak.current} {streak.current === 1 ? "day" : "days"}
        </p>
        <p className="text-sm text-muted-foreground">
          {streak.activeToday ? "You've practised today." : "Practise today to keep it going."} Level {level} · {xp} XP
        </p>
        <Button asChild variant="ghost" size="sm" className="mt-auto self-start">
          <Link href="/arena/progress">See your progress</Link>
        </Button>
      </Card>
    </div>
  );
}

export default function ArenaHomePage() {
  const { status } = useSession();
  const signedIn = status === "authenticated";
  const tracks = useApi(() => arenaApi.tracks(), [status], { enabled: status !== "loading" });
  const dashboard = useApi(() => arenaApi.dashboard(), [status], { enabled: signedIn });
  const assigned = useApi(() => arenaApi.myAssignments(), [status], { enabled: signedIn });

  return (
    <ArenaShell>
      <Container size="xl" className="space-y-10">
        <PageHeader
          title="ML Arena"
          description="Practise the maths, Python and machine learning behind real models: short lessons, then problems you solve by calculating, predicting and writing code that's checked against hidden tests."
          actions={
            signedIn ? null : (
              <Button asChild variant="primary" size="sm">
                <Link href="/login?next=/arena">Sign in to track progress</Link>
              </Button>
            )
          }
        />

        {signedIn && dashboard.data ? <NextUp dashboard={dashboard.data} /> : null}
        {signedIn ? <Assigned assignments={assigned.data} /> : null}
        {signedIn && dashboard.data ? (
          <Recommendations
            recommendations={dashboard.data.recommendations}
            reviewDueCount={dashboard.data.reviewDueCount}
          />
        ) : null}

        <section className="space-y-4">
          <h2 className="text-lg font-semibold">Tracks</h2>
          {tracks.loading || status === "loading" ? (
            <div className="grid gap-4 md:grid-cols-3">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-44" />
              ))}
            </div>
          ) : tracks.error ? (
            <Card>
              <EmptyState
                title="Couldn't load ML Arena"
                description="The arena service didn't respond. Check that it's running and try again."
                action={
                  <Button size="sm" onClick={tracks.reload}>
                    Retry
                  </Button>
                }
              />
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-3">
              {tracks.data.map((track, i) => (
                <Link key={track.id} href={`/arena/tracks/${track.id}`} className="group">
                  <Card className="flex h-full flex-col gap-3 p-5 transition-colors group-hover:border-primary">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs text-muted-foreground">{String(i + 1).padStart(2, "0")}</span>
                      <Badge tone={TRACK_LEVEL[track.level]?.tone}>{TRACK_LEVEL[track.level]?.label}</Badge>
                    </div>
                    <div>
                      <h3 className="font-semibold">{track.title}</h3>
                      <p className="mt-1 line-clamp-3 text-sm text-muted-foreground">{track.summary}</p>
                    </div>
                    <div className="mt-auto space-y-2">
                      <p className="text-xs text-muted-foreground">
                        {track.topicCount} topics · {track.itemCount} problems
                        {signedIn ? ` · ${track.solvedCount} solved` : ""}
                      </p>
                      {signedIn ? <MasteryBar value={track.mastery} /> : null}
                    </div>
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </section>

        <section className="space-y-4">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <FlaskConical className="size-5 text-muted-foreground" />
            Interactive lab
          </h2>
          <div className="grid gap-4 md:grid-cols-2">
            {LABS.map((lab) => (
              <Link key={lab.href} href={lab.href} className="group">
                <Card className="h-full p-5 transition-colors group-hover:border-primary">
                  <h3 className="font-semibold">{lab.title}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{lab.description}</p>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      </Container>
    </ArenaShell>
  );
}
