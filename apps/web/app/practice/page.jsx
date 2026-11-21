"use client";
import Link from "next/link";
import { ArrowRight, Binary, Braces, BrainCircuit, Code2, Database, Globe, ListChecks, Network, Sigma, Table2, Timer, Trophy, UserRound, Workflow } from "lucide-react";
import { Card, Container, PageHeader, Skeleton } from "@logixai/ui";
import AppHeader from "@/app/components/layout/AppHeader";
import { arenaApi } from "@/app/lib/api/arena";
import { useApi } from "@/app/lib/api/useApi";
import { MasteryBar } from "../arena/_components/bits";

const TRACK_ICON = {
  "sql-interview": Database,
  "pandas-interview": Table2,
  "numpy-interview": Sigma,
  "pytorch-interview": Binary,
  "frontend-interview": Globe,
  "system-design": Network,
  "llm-agents": Workflow,
};

const MORE = [
  {
    href: "/problems",
    icon: Code2,
    title: "Data structures and algorithms",
    text: "Classic coding problems in Python, Java and C++, judged on hidden tests.",
  },
  {
    href: "/arena",
    icon: BrainCircuit,
    title: "ML foundations",
    text: "Maths for ML, Python and NumPy, and ML fundamentals — lessons, labs and practice.",
  },
  {
    href: "/practice/playground",
    icon: Braces,
    title: "JavaScript and React playground",
    text: "A scratchpad with a live preview: try components, hooks and async code in your browser.",
  },
];

/** Timed practice and your profile. */
const COMPETE = [
  {
    href: "/practice/mock",
    icon: Timer,
    title: "Mock interviews",
    text: "Timed rounds for data, ML, frontend, system design and LLM roles, with a report afterwards.",
  },
  { href: "/practice/contests", icon: Trophy, title: "Weekly contests", text: "Every Sunday: four questions, 90 minutes, a leaderboard. Free for everyone." },
  { href: "/practice/profile", icon: UserRound, title: "Your public profile", text: "Solved counts, streak and contest ranks on a page you can share." },
];

function TrackCard({ track }) {
  const Icon = TRACK_ICON[track.id] ?? ListChecks;
  return (
    <Link href={`/arena/tracks/${track.id}`} className="group">
      <Card className="flex h-full flex-col gap-3 p-5 transition-colors group-hover:border-primary">
        <span className="grid size-10 place-items-center rounded-lg bg-primary-soft text-primary">
          <Icon className="size-5" />
        </span>
        <div>
          <p className="font-semibold">{track.title}</p>
          <p className="mt-1 text-sm text-muted-foreground">{track.summary}</p>
        </div>
        <p className="mt-auto text-xs text-muted-foreground">
          {track.itemCount} problems · {track.topicCount} topics
        </p>
        <MasteryBar value={track.mastery} />
      </Card>
    </Link>
  );
}

export default function PracticeHub() {
  const tracks = useApi(() => arenaApi.tracks(), []);
  const lists = useApi(() => arenaApi.lists(), []);
  const interview = (tracks.data ?? []).filter((t) => t.level === "interview");

  return (
    <>
      <AppHeader />
      <main className="py-8">
        <Container size="xl" className="space-y-10">
          <PageHeader
            title="Practice"
            description="Interview practice for data, ML and software roles: write real SQL, Pandas, NumPy, PyTorch, JavaScript and React, build system-design components tested against simulated traffic, and LLM apps and LangGraph agents."
          />

          <section className="space-y-3">
            <h2 className="text-lg font-semibold">Interview tracks</h2>
            {tracks.loading ? (
              <div className="grid gap-4 md:grid-cols-3">
                <Skeleton className="h-48" />
                <Skeleton className="h-48" />
                <Skeleton className="h-48" />
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-3">
                {interview.map((t) => (
                  <TrackCard key={t.id} track={t} />
                ))}
              </div>
            )}
          </section>

          {lists.data?.length ? (
            <section className="space-y-3">
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="text-lg font-semibold">Curated lists</h2>
                <Link href="/arena/problems" className="flex items-center gap-1 text-sm font-medium text-primary hover:underline">
                  All problems
                  <ArrowRight className="size-4" />
                </Link>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                {lists.data.map((l) => (
                  <Link key={l.id} href={`/arena/problems?list=${l.id}`} className="group">
                    <Card className="flex h-full flex-col gap-2 p-4 transition-colors group-hover:border-primary">
                      <p className="flex items-center gap-2 text-sm font-semibold">
                        <ListChecks className="size-4 shrink-0 text-primary" />
                        {l.title}
                      </p>
                      <p className="line-clamp-3 text-xs text-muted-foreground">{l.summary}</p>
                      <p className="mt-auto text-xs font-medium tabular-nums">
                        {l.solvedCount} / {l.itemCount} solved
                      </p>
                    </Card>
                  </Link>
                ))}
              </div>
            </section>
          ) : null}

          <section className="space-y-3">
            <h2 className="text-lg font-semibold">More practice</h2>
            <div className="grid gap-4 md:grid-cols-3">
              {MORE.map(({ href, icon: Icon, title, text }) => (
                <Link key={href} href={href} className="group">
                  <Card className="flex h-full items-start gap-4 p-5 transition-colors group-hover:border-primary">
                    <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-muted">
                      <Icon className="size-5" />
                    </span>
                    <div>
                      <p className="font-semibold">{title}</p>
                      <p className="mt-1 text-sm text-muted-foreground">{text}</p>
                    </div>
                  </Card>
                </Link>
              ))}
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold">Interview conditions</h2>
            <div className="grid gap-4 md:grid-cols-3">
              {COMPETE.map(({ href, icon: Icon, title, text }) => (
                <Link key={href} href={href} className="group">
                  <Card className="flex h-full flex-col gap-2 p-5 transition-colors group-hover:border-primary">
                    <Icon className="size-5 text-primary" />
                    <p className="font-semibold">{title}</p>
                    <p className="text-sm text-muted-foreground">{text}</p>
                  </Card>
                </Link>
              ))}
            </div>
          </section>
        </Container>
      </main>
    </>
  );
}
