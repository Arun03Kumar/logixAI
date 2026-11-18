"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { Card, Container, EmptyState, PageHeader, Skeleton, cn } from "@logixai/ui";
import { arenaApi } from "@/app/lib/api/arena";
import { useApi } from "@/app/lib/api/useApi";
import { useSession } from "@/app/lib/auth/useSession";
import ArenaShell from "../_components/ArenaShell";
import { MasteryBar } from "../_components/bits";
import { pct } from "../_components/labels";

const NODE_W = 168;
const NODE_H = 52;
const COL_GAP = 64;
const ROW_GAP = 18;
const PAD = 16;

/** Columns by prerequisite depth; rows grouped by track within a column. */
function layout(map) {
  const cols = new Map();
  for (const t of map.topics) {
    if (!cols.has(t.depth)) cols.set(t.depth, []);
    cols.get(t.depth).push(t);
  }
  const trackOrder = [...new Set(map.topics.map((t) => t.trackId))];
  const pos = new Map();
  let height = 0;
  for (const [depth, nodes] of cols) {
    nodes.sort((a, b) => trackOrder.indexOf(a.trackId) - trackOrder.indexOf(b.trackId));
    nodes.forEach((n, i) => {
      pos.set(n.id, { x: PAD + depth * (NODE_W + COL_GAP), y: PAD + i * (NODE_H + ROW_GAP) });
    });
    height = Math.max(height, PAD * 2 + nodes.length * (NODE_H + ROW_GAP) - ROW_GAP);
  }
  const width = PAD * 2 + cols.size * (NODE_W + COL_GAP) - COL_GAP;
  return { pos, width, height };
}

/** Mastery as a fill strength (0 = outline only). */
function fill(mastery) {
  if (mastery >= 0.8) return "fill-success-soft stroke-success";
  if (mastery >= 0.5) return "fill-primary-soft stroke-primary";
  if (mastery > 0) return "fill-warning-soft stroke-warning";
  return "fill-card stroke-border";
}

function Graph({ map, onOpen, focus, setFocus }) {
  const { pos, width, height } = useMemo(() => layout(map), [map]);
  const related = useMemo(() => {
    if (!focus) return null;
    const set = new Set([focus]);
    // Everything this topic builds on, transitively.
    const stack = [focus];
    while (stack.length) {
      const id = stack.pop();
      for (const e of map.edges) {
        if (e.to === id && !set.has(e.from)) {
          set.add(e.from);
          stack.push(e.from);
        }
      }
    }
    return set;
  }, [focus, map]);

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-muted/40">
      <svg width={width} height={height} role="img" aria-label="Topics and the prerequisites they build on">
        {map.edges.map((e) => {
          const a = pos.get(e.from);
          const b = pos.get(e.to);
          if (!a || !b) return null;
          const x1 = a.x + NODE_W;
          const y1 = a.y + NODE_H / 2;
          const x2 = b.x;
          const y2 = b.y + NODE_H / 2;
          const mid = (x1 + x2) / 2;
          const on = related && related.has(e.from) && related.has(e.to);
          return (
            <path
              key={`${e.from}-${e.to}`}
              d={`M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}`}
              fill="none"
              strokeWidth={on ? 2 : 1}
              className={on ? "stroke-primary" : related ? "stroke-border/40" : "stroke-muted-foreground/40"}
            />
          );
        })}
        {map.topics.map((t) => {
          const p = pos.get(t.id);
          const dim = related && !related.has(t.id);
          return (
            <g
              key={t.id}
              transform={`translate(${p.x},${p.y})`}
              className={cn("cursor-pointer transition-opacity", dim && "opacity-35")}
              onClick={() => onOpen(t.id)}
              onMouseEnter={() => setFocus(t.id)}
              onMouseLeave={() => setFocus(null)}
              onFocus={() => setFocus(t.id)}
              onBlur={() => setFocus(null)}
              tabIndex={0}
              role="link"
              aria-label={`${t.title}, ${pct(t.mastery)} mastery${t.struggling ? ", needs attention" : ""}`}
              onKeyDown={(e) => e.key === "Enter" && onOpen(t.id)}
            >
              <rect width={NODE_W} height={NODE_H} rx="8" strokeWidth={t.struggling ? 2 : 1} className={cn(fill(t.mastery), t.struggling && "stroke-danger")} />
              <foreignObject x="8" y="6" width={NODE_W - 16} height={NODE_H - 12}>
                <div className="flex h-full flex-col justify-center text-[11px] leading-tight text-foreground">
                  <span className="line-clamp-2 font-medium">{t.title}</span>
                  <span className="text-muted-foreground">
                    {t.solvedCount}/{t.itemCount} · {pct(t.mastery)}
                  </span>
                </div>
              </foreignObject>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export default function SkillMapPage() {
  const router = useRouter();
  const { status } = useSession();
  const map = useApi(() => arenaApi.skillMap(), [status], { enabled: status !== "loading" });
  const [focus, setFocus] = useState(null);
  const struggling = map.data?.topics.filter((t) => t.struggling) ?? [];

  return (
    <ArenaShell>
      <Container size="xl" className="space-y-6">
        <PageHeader
          title="Skill map"
          description="Every topic and what it builds on, left to right. Hover a topic to trace its prerequisites; colour shows your mastery."
        />
        {map.loading || !map.data ? (
          map.error ? <EmptyState title="Couldn't load the skill map" description={map.error.message} /> : <Skeleton className="h-96" />
        ) : (
          <>
            {struggling.length ? (
              <Card className="space-y-3 border-warning p-5">
                <h2 className="flex items-center gap-2 font-semibold">
                  <AlertTriangle className="size-4 text-warning" />
                  Where you&apos;re stuck
                </h2>
                {struggling.map((t) => (
                  <div key={t.id} className="text-sm">
                    <Link href={`/arena/topics/${t.id}`} className="font-medium hover:text-primary">
                      {t.title}
                    </Link>
                    {t.rootCauses.length ? (
                      <span className="text-muted-foreground">
                        {" "}— it builds on{" "}
                        {t.rootCauses.map((c, i) => (
                          <span key={c.id}>
                            {i > 0 ? (i === t.rootCauses.length - 1 ? " and " : ", ") : ""}
                            <Link href={`/arena/topics/${c.id}`} className="text-primary underline underline-offset-2">
                              {c.title}
                            </Link>
                          </span>
                        ))}
                        , which you haven&apos;t mastered yet. Shoring those up usually unlocks it.
                      </span>
                    ) : (
                      <span className="text-muted-foreground"> — try the hints and the lesson again; its prerequisites look solid.</span>
                    )}
                  </div>
                ))}
              </Card>
            ) : null}
            <Graph map={map.data} onOpen={(id) => router.push(`/arena/topics/${id}`)} focus={focus} setFocus={setFocus} />
            <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
              {[
                ["fill-card stroke-border", "Not started"],
                ["fill-warning-soft stroke-warning", "Under 50%"],
                ["fill-primary-soft stroke-primary", "50–80%"],
                ["fill-success-soft stroke-success", "80%+"],
                ["fill-card stroke-danger", "Needs attention"],
              ].map(([cls, label]) => (
                <span key={label} className="flex items-center gap-1.5">
                  <svg width="14" height="14" aria-hidden="true">
                    <rect x="1" y="1" width="12" height="12" rx="3" strokeWidth="1.5" className={cls} />
                  </svg>
                  {label}
                </span>
              ))}
            </div>
            {status === "authenticated" ? null : (
              <p className="text-sm text-muted-foreground">
                <Link href="/login?next=/arena/skills" className="text-primary underline underline-offset-2">
                  Sign in
                </Link>{" "}
                to see your own mastery on the map.
              </p>
            )}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {map.data.topics
                .filter((t) => t.started)
                .sort((a, b) => a.mastery - b.mastery)
                .slice(0, 6)
                .map((t) => (
                  <Link key={t.id} href={`/arena/topics/${t.id}`} className="group">
                    <Card className="space-y-2 p-4 transition-colors group-hover:border-primary">
                      <p className="text-sm font-medium">{t.title}</p>
                      <MasteryBar value={t.mastery} />
                    </Card>
                  </Link>
                ))}
            </div>
          </>
        )}
      </Container>
    </ArenaShell>
  );
}
