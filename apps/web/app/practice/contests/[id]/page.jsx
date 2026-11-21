"use client";
import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { ArrowLeft, ArrowRight, Play } from "lucide-react";
import { Badge, Button, Card, Container, DifficultyBadge, EmptyState, PageHeader, Skeleton, cn } from "@logixai/ui";
import AppHeader from "@/app/components/layout/AppHeader";
import MathMarkdown from "@/app/components/MathMarkdown";
import { ITEM_TYPE } from "@/app/arena/_components/labels";
import { arenaApi } from "@/app/lib/api/arena";
import { useApi } from "@/app/lib/api/useApi";
import { useSession } from "@/app/lib/auth/useSession";
import { clock, useNow, when } from "../../_components/session";

const STATUS = {
  live: { label: "Live", tone: "success" },
  upcoming: { label: "Upcoming", tone: "info" },
  ended: { label: "Ended", tone: "neutral" },
};

function Row({ r }) {
  return (
    <tr className={cn("border-t border-border", r.me && "bg-primary-soft")}>
      <td className="px-3 py-2 font-mono tabular-nums">{r.rank}</td>
      <td className="px-3 py-2">
        {r.handle ? (
          <Link href={`/u/${r.handle}`} className="hover:underline">
            {r.name}
          </Link>
        ) : (
          r.name
        )}
        {r.me ? <span className="ml-2 text-xs text-muted-foreground">(you)</span> : null}
      </td>
      <td className="px-3 py-2 text-right font-mono tabular-nums">{r.solved}</td>
      <td className="px-3 py-2 text-right font-mono tabular-nums">{r.points}</td>
      <td className="px-3 py-2 text-right font-mono tabular-nums">{r.penaltyMin}</td>
    </tr>
  );
}

function Leaderboard({ rows, myRow }) {
  if (!rows.length) return <p className="text-sm text-muted-foreground">No ranked entries yet.</p>;
  const showMine = myRow && !rows.some((r) => r.me);
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead className="bg-muted text-left text-xs text-muted-foreground">
          <tr>
            <th className="px-3 py-2 font-medium">Rank</th>
            <th className="px-3 py-2 font-medium">Name</th>
            <th className="px-3 py-2 text-right font-medium">Solved</th>
            <th className="px-3 py-2 text-right font-medium">Points</th>
            <th className="px-3 py-2 text-right font-medium">Penalty (min)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <Row key={`${r.rank}-${r.name}-${r.handle}`} r={r} />
          ))}
          {showMine ? <Row r={myRow} /> : null}
        </tbody>
      </table>
    </div>
  );
}

export default function ContestPage() {
  const { id } = useParams();
  const router = useRouter();
  const { status } = useSession();
  const signedIn = status === "authenticated";
  const contest = useApi(() => arenaApi.contest(id), [id, status], { enabled: status !== "loading" });
  const [joining, setJoining] = useState(false);
  const now = useNow();
  const c = contest.data;

  const join = async () => {
    setJoining(true);
    try {
      const session = await arenaApi.joinContest(id);
      router.push(`/practice/session/${session.id}`);
    } catch (err) {
      toast.error(err.message);
      setJoining(false);
    }
  };

  const mine = c?.mySession;
  const inProgress = mine && !mine.over;

  return (
    <>
      <AppHeader />
      <main className="py-8">
        <Container size="md" className="space-y-6">
          <Link href="/practice/contests" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-4" />
            Contests
          </Link>
          {!c ? (
            contest.error ? <EmptyState title="Contest not found" description={contest.error.message} /> : <Skeleton className="h-64" />
          ) : (
            <>
              <PageHeader
                title={
                  <span className="flex flex-wrap items-center gap-2">
                    {c.title} <Badge tone={STATUS[c.status].tone}>{STATUS[c.status].label}</Badge>
                  </span>
                }
                description={`${when(c.startsAt)} · ${c.questionCount} questions · ${Math.round((new Date(c.endsAt) - new Date(c.startsAt)) / 60000)} minutes`}
                actions={
                  c.status === "upcoming" ? (
                    <span className="font-mono text-lg tabular-nums">starts in {clock(new Date(c.startsAt).getTime() - now)}</span>
                  ) : !signedIn ? (
                    <Button asChild variant="primary" size="sm">
                      <Link href={`/login?next=/practice/contests/${c.id}`}>Sign in to take part</Link>
                    </Button>
                  ) : inProgress ? (
                    <Button asChild variant="primary" size="sm">
                      <Link href={`/practice/session/${mine.id}`}>
                        Continue
                        <ArrowRight />
                      </Link>
                    </Button>
                  ) : c.status === "live" && mine ? null : (
                    <Button variant="primary" size="sm" onClick={join} disabled={joining}>
                      <Play />
                      {c.status === "live" ? "Join now" : "Take it virtually"}
                    </Button>
                  )
                }
              />

              {c.status === "live" ? (
                <p className="text-sm">
                  <span className="font-mono tabular-nums">{clock(new Date(c.endsAt).getTime() - now)}</span> left · {c.participants}{" "}
                  {c.participants === 1 ? "participant" : "participants"}
                </p>
              ) : null}

              <Card className="p-5">
                <MathMarkdown>{c.rules}</MathMarkdown>
              </Card>

              {c.items ? (
                <section className="space-y-2">
                  <h2 className="text-lg font-semibold">Questions</h2>
                  <Card className="divide-y divide-border">
                    {c.items.map((item, i) => (
                      <div key={item.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                        {c.status === "ended" || mine ? (
                          <Link
                            href={`/arena/items/${item.id}${inProgress ? `?session=${mine.id}` : ""}`}
                            className="font-medium hover:underline"
                          >
                            {i + 1}. {item.title}
                          </Link>
                        ) : (
                          <span className="font-medium">
                            {i + 1}. {item.title}
                          </span>
                        )}
                        <span className="ml-auto flex items-center gap-2">
                          <Badge tone="outline">{ITEM_TYPE[item.type] ?? item.type}</Badge>
                          <DifficultyBadge difficulty={item.difficulty} />
                          <span className="w-14 text-right text-sm font-mono tabular-nums">{item.points} pts</span>
                        </span>
                      </div>
                    ))}
                  </Card>
                  {c.status === "live" && !mine ? <p className="text-xs text-muted-foreground">Join to open the questions.</p> : null}
                </section>
              ) : null}

              {c.status !== "upcoming" ? (
                <section className="space-y-2">
                  <h2 className="text-lg font-semibold">Leaderboard</h2>
                  <Leaderboard rows={c.leaderboard} myRow={c.myRow} />
                  <p className="text-xs text-muted-foreground">
                    Names are shortened unless the participant has a public profile.{" "}
                    <Link href="/practice/profile" className="text-primary hover:underline">
                      Set up yours
                    </Link>
                    .
                  </p>
                </section>
              ) : null}
            </>
          )}
        </Container>
      </main>
    </>
  );
}
