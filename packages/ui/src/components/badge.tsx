import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/cn";

export const badgeVariants = cva(
  "inline-flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium",
  {
    variants: {
      tone: {
        neutral: "bg-muted text-muted-foreground",
        brand: "bg-primary-soft text-primary-soft-foreground",
        success: "bg-success-soft text-success",
        warning: "bg-warning-soft text-warning",
        danger: "bg-danger-soft text-danger",
        info: "bg-info-soft text-info",
        outline: "border border-border text-muted-foreground",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

type Tone = NonNullable<BadgeProps["tone"]>;

const DIFFICULTY: Record<string, { label: string; tone: Tone }> = {
  easy: { label: "Easy", tone: "success" },
  medium: { label: "Medium", tone: "warning" },
  hard: { label: "Hard", tone: "danger" },
};

export function DifficultyBadge({
  difficulty,
  className,
}: {
  difficulty?: string | null;
  className?: string;
}) {
  const entry = DIFFICULTY[(difficulty ?? "").toLowerCase()];
  if (!entry) return null;
  return (
    <Badge tone={entry.tone} className={className}>
      {entry.label}
    </Badge>
  );
}

/**
 * Judge verdicts. Accepts both per-test statuses from the evaluator
 * (SUCCESS / WA / ERROR) and submission statuses (Success / WA / TLE / RE ...).
 */
const VERDICT: Record<string, { label: string; tone: Tone }> = {
  SUCCESS: { label: "Accepted", tone: "success" },
  WA: { label: "Wrong answer", tone: "danger" },
  TLE: { label: "Time limit exceeded", tone: "warning" },
  MLE: { label: "Memory limit exceeded", tone: "warning" },
  RE: { label: "Runtime error", tone: "danger" },
  CE: { label: "Compilation error", tone: "danger" },
  ERROR: { label: "Error", tone: "danger" },
  PENDING: { label: "Judging", tone: "neutral" },
};

export function VerdictBadge({
  status,
  className,
}: {
  status?: string | null;
  className?: string;
}) {
  if (!status) return null;
  const entry = VERDICT[status.toUpperCase()] ?? {
    label: status,
    tone: "neutral" as Tone,
  };
  return (
    <Badge tone={entry.tone} className={className}>
      {entry.label}
    </Badge>
  );
}
