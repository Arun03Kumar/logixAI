"use client";
import Link from "next/link";
import { RotateCcw, Target } from "lucide-react";
import { Card, Container, DifficultyBadge, EmptyState, PageHeader, Skeleton } from "@logixai/ui";
import RequireAuth from "@/app/components/layout/RequireAuth";
import { arenaApi } from "@/app/lib/api/arena";
import { useApi } from "@/app/lib/api/useApi";
import ArenaShell from "../_components/ArenaShell";
import { ITEM_TYPE } from "../_components/labels";

const when = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short" });

function List({ entries, review }) {
  return (
    <Card className="overflow-hidden">
      <ul className="divide-y divide-border">
        {entries.map((e) => (
          <li key={e.id}>
            <Link
              href={`/arena/items/${e.id}${review ? "?review=1" : ""}`}
              className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-accent"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{e.title}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {e.topicTitle} · {ITEM_TYPE[e.type]} · {review ? "due" : "last tried"} {when.format(new Date(e.at))}
                </p>
              </div>
              <DifficultyBadge difficulty={e.difficulty} />
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Queue() {
  const queue = useApi(() => arenaApi.reviewQueue(), []);
  if (queue.loading) return <Skeleton className="h-48" />;
  if (queue.error) return <EmptyState title="Couldn't load your reviews" description={queue.error.message} />;
  const { due, retry, upcomingCount } = queue.data;
  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <RotateCcw className="size-5 text-muted-foreground" />
          Due for review ({due.length})
        </h2>
        {due.length ? (
          <List entries={due} review />
        ) : (
          <Card>
            <EmptyState
              title="Nothing due right now"
              description={
                upcomingCount
                  ? `${upcomingCount} ${upcomingCount === 1 ? "review comes" : "reviews come"} up in the next 7 days.`
                  : "Solve problems and they'll come back here at growing intervals: 1, 3, 7, 16, 35 and 90 days."
              }
            />
          </Card>
        )}
      </section>
      {retry.length ? (
        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Target className="size-5 text-muted-foreground" />
            Not solved yet ({retry.length})
          </h2>
          <List entries={retry} />
        </section>
      ) : null}
    </div>
  );
}

export default function ArenaReviewPage() {
  return (
    <ArenaShell>
      <Container size="lg" className="space-y-6">
        <PageHeader
          title="Review"
          description="Recall beats re-reading. Each problem you solve comes back after a day, then at longer gaps each time you get it right — and from the start if you miss it."
        />
        <RequireAuth>
          <Queue />
        </RequireAuth>
      </Container>
    </ArenaShell>
  );
}
