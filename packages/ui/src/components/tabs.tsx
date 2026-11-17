import * as React from "react";
import { cn } from "../lib/cn";

export interface TabItem {
  value: string;
  label: React.ReactNode;
}

/**
 * Controlled, underline-style tabs. Renders only the tab bar; the caller
 * renders the panel for the active value.
 */
export function Tabs({
  items,
  value,
  onValueChange,
  size = "md",
  className,
  "aria-label": ariaLabel,
}: {
  items: TabItem[];
  value: string;
  onValueChange: (value: string) => void;
  size?: "sm" | "md";
  className?: string;
  "aria-label"?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn("flex items-center gap-5 border-b border-border", className)}
    >
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={active}
            data-active={active}
            onClick={() => onValueChange(item.value)}
            className={cn(
              "-mb-px inline-flex items-center gap-2 border-b-2 border-transparent font-medium text-muted-foreground transition-colors hover:text-foreground data-[active=true]:border-primary data-[active=true]:text-foreground",
              size === "sm" ? "h-9 text-xs" : "h-10 text-sm",
            )}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
