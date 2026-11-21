"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import toast from "react-hot-toast";
import { ArrowLeft, ArrowRight, CheckCircle2, Circle, Flag } from "lucide-react";
import { Badge, Button, Card, Container, DifficultyBadge, EmptyState, PageHeader, Skeleton, cn } from "@logixai/ui";
import AppHeader from "@/app/components/layout/AppHeader";
import { ITEM_TYPE } from "@/app/arena/_components/labels";
import { arenaApi } from "@/app/lib/api/arena";
import { useApi } from "@/app/lib/api/useApi";
import { useSession } from "@/app/lib/auth/useSession";
import { Countdown, SignInPrompt, VERDICT, useNow } from "../../_components/session";

function Report({ session }) {
  const r = session.report;
  const v = VERDICT[r.verdict];
  return (
    <Card className="space-y-4 p-5">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-3xl font-semibold tabular-nums">{Math.round(r.score * 100)}%</p>
        <Badge tone={v.tone}>{v.label}</Badge>
        <span className="text-sm text-muted-foreground">
          {r.solved} of {r.total} solved
          {session.kind === "contest" ? ` · ${session.points} points · ${session.penaltyMin} min penalty` : ""}
        </span>
      </div>
      <p className="text-sm">{v.text}</p>
      {r.practiceNext.length ? (
        <div className="space-y-2">
          <p className="text-sm font-semibold">Practise next</p>
          <div className="flex flex-wrap gap-2">
            {r.practiceNext.map((t) => (
              <Button key={t.topicId} asChild size="sm" variant="secondary">
                <Link href={`/arena/topics/${t.topicId}`}>{t.topicTitle}</Link>
              </Button>
            ))}
          </div>
        </div>
      ) : null}
      <p className="text-xs text-muted-foreground">Score weights questions by difficulty. Solutions are now available on each question.</p>
    </Card>
  );
}

export default function SessionPage() {
  const { id } = useParams();
  const { status } = useSession();
  const signedIn = status === "authenticated";
  const session = useApi(() => arenaApi.session(id), [id, status], { enabled: signedIn });
  const [ending, setEnding] = useState(false);
  const now = useNow(5000);
  const s = session.data;
  const timeUp = s && !s.over && new Date(s.endsAt).getTime() <= now;

  // Refresh once when the clock runs out, so the report appears.
  const { reload } = session;
  useEffect(() => {
    if (timeUp) reload();
  }, [timeUp, reload]);

  const end = async () => {
    if (!window.confirm("End now? Unsolved questions count as missed.")) return;
    setEnding(true);
    try {
      session.setData(await arenaApi.finishSession(id));
    } catch (err) {
      toast.error(err.message);
    } finally {
      setEnding(false);
    }
  };

  return (
    <>
      <AppHeader />
      <main className="py-8">
        <Container size="md" className="space-y-6">
          <Link
            href={s?.kind === "contest" ? `/practice/contests/${s.sourceId}` : "/practice/mock"}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
            {s?.kind === "contest" ? "Contest" : "Mock interviews"}
          </Link>
          {!signedIn ? (
            status === "loading" ? <Skeleton className="h-32" /> : <SignInPrompt next={`/practice/session/${id}`} what="see this session" />
          ) : !s ? (
            session.error ? <EmptyState title="Session not found" description={session.error.message} /> : <Skeleton className="h-64" />
          ) : (
            <>
              <PageHeader
                title={s.title}
                description={
                  s.over
                    ? "Finished. Here's how it went."
                    : "Open each question, solve it, and come back here. Submit code with Submit (Run doesn't count). Solutions are hidden until the end."
                }
                actions={
                  !s.over ? (
                    <div className="flex items-center gap-3">
                      <Countdown endsAt={s.endsAt} className="text-lg" />
                      {s.kind === "mock" ? (
                        <Button variant="secondary" size="sm" onClick={end} disabled={ending}>
                          <Flag />
                          End now
                        </Button>
                      ) : null}
                    </div>
                  ) : null
                }
              />
              {s.report ? <Report session={s} /> : null}
              <Card className="divide-y divide-border">
                {s.items.map((item, i) => (
                  <Link
                    key={item.id}
                    href={`/arena/items/${item.id}?session=${s.id}`}
                    className="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-accent"
                  >
                    {item.solved ? <CheckCircle2 className="size-5 text-success" /> : <Circle className="size-5 text-muted-foreground" />}
                    <span className="min-w-0">
                      <span className="block font-medium">
                        {i + 1}. {item.title}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {item.trackTitle} · {item.topicTitle}
                      </span>
                    </span>
                    <span className="ml-auto flex flex-wrap items-center gap-2">
                      <Badge tone="outline">{ITEM_TYPE[item.type] ?? item.type}</Badge>
                      <DifficultyBadge difficulty={item.difficulty} />
                      {item.solved ? (
                        <span className="text-xs text-muted-foreground">at {item.solvedAfterMin} min</span>
                      ) : null}
                      {item.wrongAttempts ? (
                        <span className={cn("text-xs", item.solved ? "text-muted-foreground" : "text-danger")}>
                          {item.wrongAttempts} wrong
                        </span>
                      ) : null}
                      <ArrowRight className="size-4 text-muted-foreground" />
                    </span>
                  </Link>
                ))}
              </Card>
            </>
          )}
        </Container>
      </main>
    </>
  );
}
