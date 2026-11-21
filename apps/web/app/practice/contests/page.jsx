"use client";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Trophy, Users } from "lucide-react";
import { Badge, Card, Container, PageHeader, Skeleton } from "@logixai/ui";
import AppHeader from "@/app/components/layout/AppHeader";
import { arenaApi } from "@/app/lib/api/arena";
import { useApi } from "@/app/lib/api/useApi";
import { clock, useNow, when } from "../_components/session";

const STATUS = {
  live: { label: "Live", tone: "success" },
  upcoming: { label: "Upcoming", tone: "info" },
  ended: { label: "Ended", tone: "neutral" },
};

function ContestRow({ c, now }) {
  const s = STATUS[c.status];
  const startsIn = new Date(c.startsAt).getTime() - now;
  const endsIn = new Date(c.endsAt).getTime() - now;
  return (
    <Link href={`/practice/contests/${c.id}`} className="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-accent">
      <Trophy className="size-5 text-muted-foreground" />
      <span className="min-w-0">
        <span className="block font-medium">{c.title}</span>
        <span className="block text-xs text-muted-foreground">
          {when(c.startsAt)} · {c.questionCount} questions
        </span>
      </span>
      <span className="ml-auto flex items-center gap-3 text-sm">
        {c.status === "upcoming" && startsIn < 7 * 86_400_000 ? <span className="font-mono tabular-nums">starts in {clock(startsIn)}</span> : null}
        {c.status === "live" ? <span className="font-mono tabular-nums">{clock(endsIn)} left</span> : null}
        {c.status !== "upcoming" ? (
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <Users className="size-4" />
            {c.participants}
          </span>
        ) : null}
        <Badge tone={s.tone}>{s.label}</Badge>
        <ArrowRight className="size-4 text-muted-foreground" />
      </span>
    </Link>
  );
}

export default function ContestsPage() {
  const contests = useApi(() => arenaApi.contests(), []);
  const now = useNow();
  return (
    <>
      <AppHeader />
      <main className="py-8">
        <Container size="md" className="space-y-6">
          <Link href="/practice" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-4" />
            Practice
          </Link>
          <PageHeader
            title="Weekly contests"
            description="Every Sunday at 10:00 India time: four auto-graded questions in 90 minutes, ranked by points and time. Free for everyone, Pro questions included. Missed one? Take it later as a virtual contest."
          />
          {!contests.data ? (
            <Skeleton className="h-64" />
          ) : (
            <Card className="divide-y divide-border">
              {contests.data.map((c) => (
                <ContestRow key={c.id} c={c} now={now} />
              ))}
            </Card>
          )}
        </Container>
      </main>
    </>
  );
}
