"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowRight, CheckCircle2, Circle, Clock, PlayCircle } from "lucide-react";
import { Badge, Button, Card, Container, EmptyState, Skeleton, cn } from "@logixai/ui";
import { arenaApi } from "@/app/lib/api/arena";
import { useApi } from "@/app/lib/api/useApi";
import { useSession } from "@/app/lib/auth/useSession";
import { itemHref, topicHref, trackHref } from "@/app/lib/areas";
import ArenaShell from "../../_components/ArenaShell";
import { Crumbs, MasteryBar } from "../../_components/bits";

function Section({ course, section, index, moduleNumber, signedIn }) {
  const done = section.itemCount > 0 && section.solvedCount === section.itemCount;
  return (
    <li>
      <Link href={topicHref(course.area, section.id)} className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-accent">
        {done ? <CheckCircle2 className="size-5 shrink-0 text-success" /> : <Circle className="size-5 shrink-0 text-muted-foreground" />}
        <span className="w-10 shrink-0 font-mono text-xs text-muted-foreground">
          {moduleNumber}.{index + 1}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-medium">{section.title}</span>
          <span className="block truncate text-xs text-muted-foreground">{section.summary}</span>
        </span>
        <span className="hidden shrink-0 text-xs text-muted-foreground sm:block">
          {signedIn ? `${section.solvedCount}/${section.itemCount}` : `${section.itemCount} problems`}
        </span>
        <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
      </Link>
    </li>
  );
}

function Module({ course, module, signedIn }) {
  const planned = module.status === "planned";
  return (
    <Card className={cn("overflow-hidden", planned && "opacity-90")}>
      <div className="space-y-2 border-b border-border px-5 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-sm text-muted-foreground">Module {module.number}</span>
          {planned ? (
            <Badge tone="neutral">
              <Clock className="mr-1 inline size-3" />
              Coming soon
            </Badge>
          ) : null}
        </div>
        <h2 className="text-lg font-semibold">
          {module.trackId ? (
            <Link href={trackHref(course.area, module.trackId)} className="hover:underline">
              {module.title}
            </Link>
          ) : (
            module.title
          )}
        </h2>
        <p className="text-sm text-muted-foreground">{module.summary}</p>
        {!planned && signedIn ? <MasteryBar value={module.mastery} /> : null}
      </div>
      {module.sections.length ? (
        <ol className="divide-y divide-border">
          {module.sections.map((s, i) => (
            <Section key={s.id} course={course} section={s} index={i} moduleNumber={module.number} signedIn={signedIn} />
          ))}
        </ol>
      ) : null}
      {module.practice.length ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-border px-5 py-3 text-sm">
          <span className="text-muted-foreground">{planned ? "Practise meanwhile:" : "More practice:"}</span>
          {module.practice.map((t) => (
            <Link key={t.id} href={trackHref(course.area, t.id)} className="text-primary hover:underline">
              {t.title}
            </Link>
          ))}
        </div>
      ) : null}
    </Card>
  );
}

export default function CoursePage() {
  const { courseId } = useParams();
  const { status } = useSession();
  const signedIn = status === "authenticated";
  const course = useApi(() => arenaApi.course(courseId), [courseId, status], { enabled: status !== "loading" });
  const c = course.data;

  return (
    <ArenaShell>
      <Container size="lg" className="space-y-6">
        {!c ? (
          course.error ? <EmptyState title="Course not found" description={course.error.message} /> : <Skeleton className="h-96" />
        ) : (
          <>
            <Crumbs items={[{ label: "ML Arena", href: "/arena" }, { label: c.title }]} />
            <div className="space-y-3">
              <h1 className="text-2xl font-semibold">{c.title}</h1>
              <p className="text-muted-foreground">{c.summary}</p>
              <p className="text-sm text-muted-foreground">
                {c.moduleCount} modules · {c.availableModules} ready now, more being added · {c.sectionCount} sections · {c.itemCount} problems
              </p>
              {signedIn ? <MasteryBar value={c.mastery} label="Course progress" /> : null}
              {c.next ? (
                <Button asChild variant="primary">
                  <Link href={itemHref(c.area, c.next.itemId)}>
                    <PlayCircle />
                    {signedIn && c.solvedCount ? "Continue" : "Start"}: {c.next.sectionTitle} — {c.next.title}
                  </Link>
                </Button>
              ) : null}
              {!signedIn ? (
                <p className="text-sm">
                  <Link href={`/login?next=/arena/course/${c.id}`} className="text-primary hover:underline">
                    Sign in
                  </Link>{" "}
                  to save your progress through the course.
                </p>
              ) : null}
            </div>
            <div className="space-y-4">
              {c.modules.map((m) => (
                <Module key={m.number} course={c} module={m} signedIn={signedIn} />
              ))}
            </div>
          </>
        )}
      </Container>
    </ArenaShell>
  );
}
