"use client";
import Link from "next/link";
import { ChevronRight, Circle, CircleCheck, CircleDot, Eye } from "lucide-react";
import { cn } from "@logixai/ui";
import { pct } from "./labels";

/** Solved / attempted / revealed / not started. */
export function StatusIcon({ status, className }) {
  const cls = cn("size-4 shrink-0", className);
  if (status === "solved") return <CircleCheck className={cn(cls, "text-success")} aria-label="Solved" />;
  if (status === "attempted") return <CircleDot className={cn(cls, "text-warning")} aria-label="Attempted" />;
  if (status === "revealed") return <Eye className={cn(cls, "text-muted-foreground")} aria-label="Answer shown" />;
  return <Circle className={cn(cls, "text-border")} aria-label="Not started" />;
}

/** Thin progress bar for mastery (0..1). */
export function MasteryBar({ value, className, label = "Mastery" }) {
  const width = Math.max(0, Math.min(1, value ?? 0)) * 100;
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <div
        className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(width)}
      >
        <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${width}%` }} />
      </div>
      <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">{pct(value)}</span>
    </div>
  );
}

/** Track > topic > here. */
export function Crumbs({ items }) {
  return (
    <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
      {items.map((item, i) => (
        <span key={item.href ?? item.label} className="flex items-center gap-1">
          {i > 0 ? <ChevronRight className="size-3.5" /> : null}
          {item.href ? (
            <Link href={item.href} className="hover:text-foreground">
              {item.label}
            </Link>
          ) : (
            <span className="text-foreground">{item.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}

export function Stat({ label, value, hint }) {
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
