"use client";
import { topicHref, useArea, useAreaRedirect } from "@/app/lib/areas";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Badge, Card, Container, EmptyState, Skeleton } from "@logixai/ui";
import { arenaApi } from "@/app/lib/api/arena";
import { useApi } from "@/app/lib/api/useApi";
import { useSession } from "@/app/lib/auth/useSession";
import ArenaShell from "../../_components/ArenaShell";
import { Crumbs, MasteryBar } from "../../_components/bits";
import { TRACK_LEVEL } from "../../_components/labels";

export default function TrackPage() {
  const { trackId } = useParams();
  const { status } = useSession();
  const signedIn = status === "authenticated";
  const track = useApi(() => arenaApi.track(trackId), [trackId, status], { enabled: status !== "loading" });
  const area = useArea();
  useAreaRedirect(track.data?.area);

  return (
    <ArenaShell>
      <Container size="lg" className="space-y-6">
        {track.loading || !track.data ? (
          track.error ? (
            <EmptyState title="Track not found" description={track.error.message} />
          ) : (
            <div className="space-y-3">
              <Skeleton className="h-8 w-1/2" />
              <Skeleton className="h-64" />
            </div>
          )
        ) : (
          <>
            <Crumbs items={[{ label: area.title, href: area.base }, { label: track.data.title }]} />
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-semibold">{track.data.title}</h1>
                <Badge tone={TRACK_LEVEL[track.data.level]?.tone}>{TRACK_LEVEL[track.data.level]?.label}</Badge>
              </div>
              <p className="max-w-2xl text-muted-foreground">{track.data.summary}</p>
              {signedIn ? <MasteryBar value={track.data.mastery} className="max-w-sm" /> : null}
            </div>

            <ol className="space-y-3">
              {track.data.topics.map((topic, i) => (
                <li key={topic.id}>
                  <Link href={topicHref(track.data.area, topic.id)} className="group block">
                    <Card className="flex gap-4 p-5 transition-colors group-hover:border-primary">
                      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-muted text-sm font-semibold tabular-nums">
                        {i + 1}
                      </span>
                      <div className="min-w-0 flex-1 space-y-2">
                        <div>
                          <h2 className="font-semibold">{topic.title}</h2>
                          <p className="text-sm text-muted-foreground">{topic.summary}</p>
                        </div>
                        {topic.prerequisites.length ? (
                          <p className="text-xs text-muted-foreground">
                            Builds on: {topic.prerequisites.map((p) => p.title).join(", ")}
                          </p>
                        ) : null}
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                          <span className="text-xs text-muted-foreground">
                            {signedIn ? `${topic.solvedCount} of ${topic.itemCount} solved` : `${topic.itemCount} problems`}
                          </span>
                          {signedIn ? <MasteryBar value={topic.mastery} className="w-48" /> : null}
                        </div>
                      </div>
                    </Card>
                  </Link>
                </li>
              ))}
            </ol>
          </>
        )}
      </Container>
    </ArenaShell>
  );
}
