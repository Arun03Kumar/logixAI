"use client";
import Link from "next/link";
import { ArrowRight, CalendarClock, GraduationCap, RotateCcw, Sparkles, Wrench } from "lucide-react";
import { Badge, Card, DifficultyBadge } from "@logixai/ui";
import { MasteryBar } from "./bits";
import { ITEM_TYPE } from "./labels";

const KIND = {
  review: { label: "Review", icon: RotateCcw, tone: "info" },
  strengthen: { label: "Strengthen", icon: Wrench, tone: "warning" },
  continue: { label: "Continue", icon: ArrowRight, tone: "brand" },
  next: { label: "New topic", icon: Sparkles, tone: "success" },
};

const dateFmt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short" });

/** "Recommended for you": why each item is suggested, not just what. */
export function Recommendations({ recommendations, reviewDueCount }) {
  if (!recommendations?.length) return null;
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">Recommended for you</h2>
        {reviewDueCount ? (
          <Link href="/arena/review" className="text-sm text-primary underline underline-offset-2">
            {reviewDueCount} {reviewDueCount === 1 ? "review" : "reviews"} due
          </Link>
        ) : null}
      </div>
      <Card className="overflow-hidden">
        <ul className="divide-y divide-border">
          {recommendations.map(({ kind, reason, item }) => {
            const k = KIND[kind];
            const Icon = k.icon;
            return (
              <li key={item.id}>
                <Link
                  href={`/arena/items/${item.id}${kind === "review" ? "?review=1" : ""}`}
                  className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-accent"
                >
                  <Icon className="size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{item.title}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {item.topicTitle} · {reason}
                    </p>
                  </div>
                  <Badge tone={k.tone} className="hidden sm:inline-flex">
                    {k.label}
                  </Badge>
                  <span className="hidden text-xs text-muted-foreground md:inline">{ITEM_TYPE[item.type]}</span>
                  <DifficultyBadge difficulty={item.difficulty} />
                </Link>
              </li>
            );
          })}
        </ul>
      </Card>
    </section>
  );
}

/** Tracks an instructor assigned to one of the learner's batches. */
export function Assigned({ assignments }) {
  if (!assignments?.length) return null;
  return (
    <section className="space-y-3">
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        <GraduationCap className="size-5 text-muted-foreground" />
        Assigned to you
      </h2>
      <div className="grid gap-3 md:grid-cols-2">
        {assignments.map((a) => (
          <Link key={a.id} href={`/arena/tracks/${a.trackId}`} className="group">
            <Card className="space-y-2 p-4 transition-colors group-hover:border-primary">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold">{a.trackTitle}</p>
                {a.dueAt ? (
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <CalendarClock className="size-3.5" />
                    Due {dateFmt.format(new Date(a.dueAt))}
                  </span>
                ) : null}
              </div>
              <p className="text-xs text-muted-foreground">
                {a.institutionName} · {a.solvedCount} of {a.itemCount} solved
              </p>
              <MasteryBar value={a.mastery} />
            </Card>
          </Link>
        ))}
      </div>
    </section>
  );
}
