"use client";
import Link from "next/link";
import { ArrowRight, Braces, Flame, ListChecks, PlayCircle, RotateCcw, Timer } from "lucide-react";
import { Badge, Button, Card, Container, PageHeader, Skeleton } from "@logixai/ui";
import { arenaApi } from "@/app/lib/api/arena";
import { useApi } from "@/app/lib/api/useApi";
import { useSession } from "@/app/lib/auth/useSession";
import { AREAS, itemHref, topicHref, trackHref } from "@/app/lib/areas";
import ArenaShell from "./ArenaShell";
import { MasteryBar, Stat } from "./bits";
import { TRACK_LEVEL } from "./labels";

/** A track as a wide card: summary and progress, then its topics as links. */
function TrackCard({ areaId, track, topics, signedIn }) {
  const started = (track.solvedCount ?? 0) > 0;
  return (
    <Card className="flex flex-col gap-4 p-5 sm:p-6">
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={trackHref(areaId, track.id)} className="text-lg font-semibold hover:text-primary">
              {track.title}
            </Link>
            <Badge tone={TRACK_LEVEL[track.level]?.tone}>{TRACK_LEVEL[track.level]?.label}</Badge>
          </div>
          <p className="max-w-3xl text-sm text-muted-foreground">{track.summary}</p>
        </div>
        <Button asChild variant="primary" size="sm" className="shrink-0">
          <Link href={trackHref(areaId, track.id)}>
            {started ? "Continue" : "Start track"}
            <ArrowRight />
          </Link>
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-muted-foreground">
        <span>{track.itemCount} problems</span>
        <span>{track.topicCount} topics</span>
        {signedIn ? (
          <span>
            {track.solvedCount} solved
          </span>
        ) : null}
        {signedIn ? <MasteryBar value={track.mastery} className="min-w-48 flex-1" /> : null}
      </div>

      {topics ? (
        <div className="grid gap-2 border-t border-border pt-4 sm:grid-cols-2">
          {topics.map((t, i) => (
            <Link
              key={t.id}
              href={topicHref(areaId, t.id)}
              className="group flex items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-muted"
            >
              <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-medium tabular-nums text-muted-foreground group-hover:bg-background">
                {i + 1}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium group-hover:text-primary">{t.title}</span>
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                {signedIn ? `${t.solvedCount ?? 0}/` : ""}
                {t.itemCount}
              </span>
            </Link>
          ))}
        </div>
      ) : null}
    </Card>
  );
}

/** Signed-in progress for this area: continue, reviews due, streak. */
function ProgressCard({ areaId, dashboard }) {
  const { continueItem, reviewDueCount, streak } = dashboard;
  return (
    <Card className="flex flex-col gap-4 p-5">
      <p className="text-sm font-semibold">Your progress</p>
      {continueItem ? (
        <Link href={itemHref(areaId, continueItem.id)} className="group flex items-start gap-3">
          <PlayCircle className="mt-0.5 size-4 shrink-0 text-primary" />
          <span className="min-w-0">
            <span className="block text-sm font-medium group-hover:text-primary">{continueItem.title}</span>
            <span className="block text-xs text-muted-foreground">Continue · {continueItem.topicTitle}</span>
          </span>
        </Link>
      ) : (
        <p className="text-sm text-muted-foreground">You&apos;ve solved everything here. New problems are on the way.</p>
      )}
      <div className="grid grid-cols-2 gap-3 border-t border-border pt-4 text-sm">
        <Link href="/arena/review" className="flex items-center gap-2 hover:text-primary">
          <RotateCcw className="size-4 text-muted-foreground" />
          <span className="tabular-nums">{reviewDueCount}</span> to review
        </Link>
        <span className="flex items-center gap-2">
          <Flame className="size-4 text-muted-foreground" />
          <span className="tabular-nums">{streak.current}</span> day streak
        </span>
      </div>
    </Card>
  );
}

function SideLink({ href, icon: Icon, title, text }) {
  return (
    <Link href={href} className="group flex items-start gap-3 rounded-md p-2 -mx-2 transition-colors hover:bg-muted">
      <Icon className="mt-0.5 size-4 shrink-0 text-primary" />
      <span className="min-w-0">
        <span className="block text-sm font-medium group-hover:text-primary">{title}</span>
        <span className="block text-xs text-muted-foreground">{text}</span>
      </span>
    </Link>
  );
}

/** Home of an area other than ML Arena (Frontend, System design): its tracks, lists and mock interviews. */
export default function AreaHome({ areaId, extras = [] }) {
  const area = AREAS[areaId];
  const { status } = useSession();
  const signedIn = status === "authenticated";
  const ready = status !== "loading";
  const tracks = useApi(() => arenaApi.tracks(areaId), [status, areaId], { enabled: ready });
  // Area homes have only a few tracks, so fetching each one's topics is cheap.
  const details = useApi(
    () => Promise.all((tracks.data ?? []).map((t) => arenaApi.track(t.id))),
    [tracks.data],
    { enabled: Boolean(tracks.data) },
  );
  const lists = useApi(() => arenaApi.lists(areaId), [status, areaId], { enabled: ready });
  const dashboard = useApi(() => arenaApi.dashboard(areaId), [status, areaId], { enabled: signedIn });
  const mocks = useApi(() => arenaApi.mocks(), [status], { enabled: signedIn });
  const templates = (mocks.data?.templates ?? []).filter((t) => t.area === areaId);

  const topicsOf = (id) => details.data?.find((d) => d.id === id)?.topics;
  const totals = (tracks.data ?? []).reduce(
    (acc, t) => ({ items: acc.items + t.itemCount, topics: acc.topics + t.topicCount, solved: acc.solved + t.solvedCount }),
    { items: 0, topics: 0, solved: 0 },
  );

  return (
    <ArenaShell>
      <Container size="xl" className="space-y-8">
        <PageHeader
          className="pb-0"
          title={area.title}
          description={area.tagline}
          actions={
            <Button asChild size="sm">
              <Link href={`${area.base}/problems`}>
                Browse all problems
                <ArrowRight />
              </Link>
            </Button>
          }
        />

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Problems" value={tracks.data ? totals.items : "–"} />
          <Stat label="Topics" value={tracks.data ? totals.topics : "–"} />
          <Stat
            label="Solved"
            value={signedIn && tracks.data ? `${totals.solved} / ${totals.items}` : "–"}
            hint={signedIn ? undefined : "Sign in to track progress"}
          />
          <Stat label="Curated lists" value={lists.data ? lists.data.length : "–"} />
        </div>

        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="min-w-0 space-y-8">
            <section className="space-y-3">
              <h2 className="text-lg font-semibold">Tracks</h2>
              {!tracks.data ? (
                <Skeleton className="h-56" />
              ) : (
                <div className="space-y-4">
                  {tracks.data.map((t) => (
                    <TrackCard key={t.id} areaId={areaId} track={t} topics={topicsOf(t.id)} signedIn={signedIn} />
                  ))}
                </div>
              )}
            </section>

            {lists.data?.length ? (
              <section className="space-y-3">
                <h2 className="text-lg font-semibold">Curated lists</h2>
                <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(18rem,1fr))]">
                  {lists.data.map((l) => (
                    <Link key={l.id} href={`${area.base}/problems?list=${l.id}`} className="group">
                      <Card className="flex h-full flex-col gap-2 p-5 transition-colors group-hover:border-primary">
                        <span className="flex items-center gap-2 font-semibold">
                          <ListChecks className="size-4 text-primary" />
                          {l.title}
                        </span>
                        <p className="text-sm text-muted-foreground">{l.summary}</p>
                        <div className="mt-auto space-y-2 pt-1">
                          {signedIn ? (
                            <MasteryBar value={l.itemCount ? l.solvedCount / l.itemCount : 0} label="Solved" />
                          ) : null}
                          <p className="text-xs text-muted-foreground">
                            {signedIn ? `${l.solvedCount} / ${l.itemCount} solved` : `${l.itemCount} problems`}
                          </p>
                        </div>
                      </Card>
                    </Link>
                  ))}
                </div>
              </section>
            ) : null}
          </div>

          <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
            {signedIn ? (
              dashboard.data ? (
                <ProgressCard areaId={areaId} dashboard={dashboard.data} />
              ) : (
                <Skeleton className="h-40" />
              )
            ) : ready ? (
              <Card className="flex flex-col gap-3 p-5">
                <p className="text-sm font-semibold">Track your progress</p>
                <p className="text-sm text-muted-foreground">
                  Sign in to save solutions, get spaced-repetition reviews and keep a streak.
                </p>
                <Button asChild variant="primary" size="sm" className="self-start">
                  <Link href={`/login?next=${area.base}`}>Sign in</Link>
                </Button>
              </Card>
            ) : null}

            <Card className="flex flex-col gap-1 p-5">
              <p className="mb-2 text-sm font-semibold">Practise under interview conditions</p>
              {templates.map((t) => (
                <SideLink
                  key={t.id}
                  href="/practice/mock"
                  icon={Timer}
                  title={t.title}
                  text={`${t.durationMin} min mock interview`}
                />
              ))}
              {!signedIn ? (
                <SideLink href="/practice/mock" icon={Timer} title="Mock interviews" text="Timed rounds with a report afterwards." />
              ) : null}
              {extras.map((e) => (
                <SideLink key={e.href} href={e.href} icon={Braces} title={e.title} text={e.text} />
              ))}
              <SideLink href="/practice/contests" icon={ListChecks} title="Weekly contests" text="Every Sunday, ranked with a leaderboard." />
            </Card>
          </aside>
        </div>
      </Container>
    </ArenaShell>
  );
}
