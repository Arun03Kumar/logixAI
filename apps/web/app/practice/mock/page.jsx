"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { ArrowLeft, ArrowRight, Play } from "lucide-react";
import { Badge, Button, Card, Container, PageHeader, Skeleton } from "@logixai/ui";
import AppHeader from "@/app/components/layout/AppHeader";
import { arenaApi } from "@/app/lib/api/arena";
import { useApi } from "@/app/lib/api/useApi";
import { useSession } from "@/app/lib/auth/useSession";
import { Duration, SignInPrompt, when } from "../_components/session";

const pct = (x) => `${Math.round(x * 100)}%`;

export default function MockHubPage() {
  const router = useRouter();
  const { status } = useSession();
  const signedIn = status === "authenticated";
  const hub = useApi(() => arenaApi.mocks(), [status], { enabled: signedIn });
  const [starting, setStarting] = useState(null);
  const data = hub.data;

  const start = async (template) => {
    if (!window.confirm(`Start "${template.title}"? The ${template.durationMin}-minute clock starts now, and solutions stay hidden until it ends.`)) return;
    setStarting(template.id);
    try {
      const session = await arenaApi.startMock(template.id);
      router.push(`/practice/session/${session.id}`);
    } catch (err) {
      toast.error(err.message);
      setStarting(null);
    }
  };

  return (
    <>
      <AppHeader />
      <main className="py-8">
        <Container size="lg" className="space-y-8">
          <Link href="/practice" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-4" />
            Practice
          </Link>
          <PageHeader
            title="Mock interviews"
            description="A timed round with fresh questions picked for you — unsolved ones first. Solve them on the usual problem pages; solutions stay hidden until time is up, then you get a report."
          />

          {!signedIn ? (
            status === "loading" ? <Skeleton className="h-32" /> : <SignInPrompt next="/practice/mock" what="take a mock interview" />
          ) : !data ? (
            <div className="grid gap-4 md:grid-cols-2">
              <Skeleton className="h-40" />
              <Skeleton className="h-40" />
            </div>
          ) : (
            <>
              {data.active ? (
                <Card className="flex flex-wrap items-center gap-3 border-primary p-5">
                  <div className="min-w-0">
                    <p className="font-semibold">In progress: {data.active.title}</p>
                    <p className="text-sm text-muted-foreground">
                      {data.active.solved} of {data.active.total} solved
                    </p>
                  </div>
                  <Button asChild variant="primary" size="sm" className="ml-auto">
                    <Link href={`/practice/session/${data.active.id}`}>
                      Continue
                      <ArrowRight />
                    </Link>
                  </Button>
                </Card>
              ) : null}

              <section className="space-y-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="text-lg font-semibold">Choose a round</h2>
                  {data.remainingThisWeek !== null ? (
                    <span className="text-sm text-muted-foreground">
                      {data.remainingThisWeek} free {data.remainingThisWeek === 1 ? "mock" : "mocks"} left this week ·{" "}
                      <Link href="/pricing" className="text-primary hover:underline">
                        Pro is unlimited
                      </Link>
                    </span>
                  ) : null}
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  {data.templates.map((t) => (
                    <Card key={t.id} className="flex flex-col gap-3 p-5">
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-semibold">{t.title}</p>
                        <Duration minutes={t.durationMin} />
                      </div>
                      <p className="text-sm text-muted-foreground">{t.summary}</p>
                      <div className="flex flex-wrap gap-1.5">
                        {t.outline.map((o) => (
                          <Badge key={o} tone="outline">
                            {o}
                          </Badge>
                        ))}
                      </div>
                      <Button
                        variant="primary"
                        size="sm"
                        className="mt-auto self-start"
                        disabled={Boolean(data.active) || starting !== null || data.remainingThisWeek === 0}
                        onClick={() => start(t)}
                      >
                        <Play />
                        {starting === t.id ? "Starting…" : "Start"}
                      </Button>
                    </Card>
                  ))}
                </div>
              </section>

              {data.history.length ? (
                <section className="space-y-3">
                  <h2 className="text-lg font-semibold">Past rounds</h2>
                  <Card className="divide-y divide-border">
                    {data.history.map((s) => (
                      <Link key={s.id} href={`/practice/session/${s.id}`} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm hover:bg-accent">
                        <span className="font-medium">{s.title}</span>
                        <span className="text-muted-foreground">{when(s.startedAt)}</span>
                        <span className="ml-auto font-mono tabular-nums">
                          {s.solved}/{s.total} · {pct(s.score)}
                        </span>
                      </Link>
                    ))}
                  </Card>
                </section>
              ) : null}
            </>
          )}
        </Container>
      </main>
    </>
  );
}

