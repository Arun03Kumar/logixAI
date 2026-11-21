"use client";
import { itemHref, topicHref, trackHref, useArea, useAreaRedirect } from "@/app/lib/areas";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { Badge, Button, Card, Container, DifficultyBadge, EmptyState, Skeleton } from "@logixai/ui";
import MathMarkdown from "@/app/components/MathMarkdown";
import { arenaApi } from "@/app/lib/api/arena";
import { useApi } from "@/app/lib/api/useApi";
import { useSession } from "@/app/lib/auth/useSession";
import ArenaShell from "../../_components/ArenaShell";
import { Crumbs, MasteryBar, StatusIcon } from "../../_components/bits";
import { ITEM_TYPE } from "../../_components/labels";

function PracticeList({ topic, signedIn }) {
  const area = topic.area;
  return (
    <Card className="overflow-hidden">
      <div className="space-y-2 border-b border-border px-5 py-4">
        <h2 className="font-semibold">Practice</h2>
        {signedIn ? (
          <MasteryBar value={topic.mastery} />
        ) : (
          <p className="text-sm text-muted-foreground">Sign in to save your answers and progress.</p>
        )}
      </div>
      <ul className="divide-y divide-border">
        {topic.items.map((item) => (
          <li key={item.id}>
            <Link
              href={itemHref(area, item.id)}
              className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-accent"
            >
              <StatusIcon status={item.status} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{item.title}</p>
                <p className="text-xs text-muted-foreground">{ITEM_TYPE[item.type]}</p>
              </div>
              {item.access === "pro" ? <Badge tone="outline">Pro</Badge> : null}
              <DifficultyBadge difficulty={item.difficulty} />
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export default function TopicPage() {
  const { topicId } = useParams();
  const { status } = useSession();
  const topic = useApi(() => arenaApi.topic(topicId), [topicId, status], { enabled: status !== "loading" });
  const t = topic.data;
  const area = useArea();
  useAreaRedirect(t?.area);

  return (
    <ArenaShell>
      <Container size="xl">
        {!t ? (
          topic.error ? (
            <EmptyState title="Topic not found" description={topic.error.message} />
          ) : (
            <div className="space-y-3">
              <Skeleton className="h-8 w-1/2" />
              <Skeleton className="h-96" />
            </div>
          )
        ) : (
          <div className="space-y-6">
            <Crumbs
              items={[
                { label: area.title, href: area.base },
                { label: t.trackTitle, href: trackHref(t.area, t.trackId) },
                { label: t.title },
              ]}
            />
            <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
              <article className="min-w-0 space-y-6">
                <header className="space-y-2">
                  <h1 className="text-2xl font-semibold">{t.title}</h1>
                  <p className="text-muted-foreground">{t.summary}</p>
                  {t.prerequisites.length ? (
                    <p className="text-sm text-muted-foreground">
                      Builds on{" "}
                      {t.prerequisites.map((p, i) => (
                        <span key={p.id}>
                          {i > 0 ? ", " : ""}
                          <Link href={topicHref(t.area, p.id)} className="text-primary underline underline-offset-2">
                            {p.title}
                          </Link>
                        </span>
                      ))}
                    </p>
                  ) : null}
                  <a href="#practice" className="inline-block text-sm text-primary underline underline-offset-2 lg:hidden">
                    Jump to practice ({t.items.length})
                  </a>
                </header>
                <Card className="p-6">
                  <MathMarkdown>{t.lesson}</MathMarkdown>
                </Card>
                <div className="flex flex-wrap justify-between gap-2">
                  {t.previousTopic ? (
                    <Button asChild variant="ghost" size="sm">
                      <Link href={topicHref(t.area, t.previousTopic.id)}>
                        <ArrowLeft />
                        {t.previousTopic.title}
                      </Link>
                    </Button>
                  ) : (
                    <span />
                  )}
                  {t.nextTopic ? (
                    <Button asChild variant="ghost" size="sm">
                      <Link href={topicHref(t.area, t.nextTopic.id)}>
                        {t.nextTopic.title}
                        <ArrowRight />
                      </Link>
                    </Button>
                  ) : null}
                </div>
              </article>
              <aside id="practice" className="lg:sticky lg:top-20 lg:self-start">
                <PracticeList topic={t} signedIn={status === "authenticated"} />
              </aside>
            </div>
          </div>
        )}
      </Container>
    </ArenaShell>
  );
}
