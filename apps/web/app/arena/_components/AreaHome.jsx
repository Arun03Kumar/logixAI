"use client";
import Link from "next/link";
import { ArrowRight, Braces, ListChecks, Timer } from "lucide-react";
import { Badge, Card, Container, PageHeader, Skeleton } from "@logixai/ui";
import { arenaApi } from "@/app/lib/api/arena";
import { useApi } from "@/app/lib/api/useApi";
import { useSession } from "@/app/lib/auth/useSession";
import { AREAS, trackHref } from "@/app/lib/areas";
import ArenaShell from "./ArenaShell";
import { MasteryBar } from "./bits";
import { TRACK_LEVEL } from "./labels";

/** Home of an area other than ML Arena (Frontend, System design): its tracks, lists and mock interviews. */
export default function AreaHome({ areaId, extras = [] }) {
  const area = AREAS[areaId];
  const { status } = useSession();
  const signedIn = status === "authenticated";
  const tracks = useApi(() => arenaApi.tracks(areaId), [status, areaId], { enabled: status !== "loading" });
  const lists = useApi(() => arenaApi.lists(areaId), [status, areaId], { enabled: status !== "loading" });
  const mocks = useApi(() => arenaApi.mocks(), [status], { enabled: signedIn });
  const templates = (mocks.data?.templates ?? []).filter((t) => t.area === areaId);

  return (
    <ArenaShell>
      <Container size="xl" className="space-y-10">
        <PageHeader title={area.title} description={area.tagline} />

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Tracks</h2>
          {!tracks.data ? (
            <Skeleton className="h-40" />
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {tracks.data.map((t) => (
                <Link key={t.id} href={trackHref(areaId, t.id)} className="group">
                  <Card className="flex h-full flex-col gap-3 p-5 transition-colors group-hover:border-primary">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-semibold">{t.title}</p>
                      <Badge tone={TRACK_LEVEL[t.level]?.tone}>{TRACK_LEVEL[t.level]?.label}</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">{t.summary}</p>
                    <p className="text-xs text-muted-foreground">
                      {t.itemCount} problems · {t.topicCount} topics
                    </p>
                    {signedIn ? <MasteryBar value={t.mastery} /> : null}
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </section>

        {lists.data?.length ? (
          <section className="space-y-3">
            <h2 className="text-lg font-semibold">Curated lists</h2>
            <div className="grid gap-4 md:grid-cols-2">
              {lists.data.map((l) => (
                <Link key={l.id} href={`${area.base}/problems?list=${l.id}`} className="group">
                  <Card className="flex h-full flex-col gap-2 p-5 transition-colors group-hover:border-primary">
                    <span className="flex items-center gap-2 font-semibold">
                      <ListChecks className="size-4 text-primary" />
                      {l.title}
                    </span>
                    <p className="text-sm text-muted-foreground">{l.summary}</p>
                    <p className="mt-auto text-xs text-muted-foreground">
                      {l.solvedCount} / {l.itemCount} solved
                    </p>
                  </Card>
                </Link>
              ))}
            </div>
          </section>
        ) : null}

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Interview conditions</h2>
          <div className="grid gap-4 md:grid-cols-3">
            {templates.map((t) => (
              <Link key={t.id} href="/practice/mock" className="group">
                <Card className="flex h-full flex-col gap-2 p-5 transition-colors group-hover:border-primary">
                  <span className="flex items-center gap-2 font-semibold">
                    <Timer className="size-4 text-primary" />
                    {t.title}
                  </span>
                  <p className="text-sm text-muted-foreground">{t.summary}</p>
                  <p className="mt-auto text-xs text-muted-foreground">{t.durationMin} min mock interview</p>
                </Card>
              </Link>
            ))}
            {!signedIn ? (
              <Link href="/practice/mock" className="group">
                <Card className="flex h-full flex-col gap-2 p-5 transition-colors group-hover:border-primary">
                  <span className="flex items-center gap-2 font-semibold">
                    <Timer className="size-4 text-primary" />
                    Mock interviews
                  </span>
                  <p className="text-sm text-muted-foreground">Timed rounds with a report afterwards.</p>
                </Card>
              </Link>
            ) : null}
            {extras.map((e) => (
              <Link key={e.href} href={e.href} className="group">
                <Card className="flex h-full flex-col gap-2 p-5 transition-colors group-hover:border-primary">
                  <span className="flex items-center gap-2 font-semibold">
                    <Braces className="size-4 text-primary" />
                    {e.title}
                  </span>
                  <p className="text-sm text-muted-foreground">{e.text}</p>
                  <span className="mt-auto inline-flex items-center gap-1 text-sm text-primary">
                    Open <ArrowRight className="size-4" />
                  </span>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      </Container>
    </ArenaShell>
  );
}
