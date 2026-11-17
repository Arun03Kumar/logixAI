import * as React from "react";
import { cn } from "../lib/cn";

/**
 * LogixAI wordmark. Pure type and a simple mark so it works on light and
 * dark backgrounds (the PNG logo has a dark background baked in).
 */
export function Logo({
  className,
  showMark = true,
}: {
  className?: string;
  showMark?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 text-[17px] font-bold tracking-tight text-foreground",
        className,
      )}
    >
      {showMark ? (
        <span
          aria-hidden="true"
          className="grid size-7 place-items-center rounded-md bg-primary text-[13px] font-bold text-primary-foreground"
        >
          X
        </span>
      ) : null}
      <span>
        Logi<span className="text-primary">x</span>AI
      </span>
    </span>
  );
}
