import * as React from "react";
import { cn } from "../lib/cn";

/** Horizontally centred content column with the standard side gutters. */
export function Container({
  className,
  size = "lg",
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { size?: "md" | "lg" | "xl" }) {
  return (
    <div
      className={cn(
        "mx-auto w-full px-4 sm:px-6",
        size === "md" && "max-w-3xl",
        size === "lg" && "max-w-6xl",
        size === "xl" && "max-w-7xl",
        className,
      )}
      {...props}
    />
  );
}

/** Title row at the top of an app page. */
export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-end justify-between gap-4 pb-6",
        className,
      )}
    >
      <div className="min-w-0 space-y-1">
        <h1 className="text-2xl font-semibold text-foreground">{title}</h1>
        {description ? (
          <p className="max-w-2xl text-sm text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/** Small uppercase-free label above a section heading. */
export function Eyebrow({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      className={cn("text-sm font-semibold text-primary", className)}
      {...props}
    />
  );
}
