import * as React from "react";
import { cn } from "../lib/cn";

const fieldBase =
  "w-full rounded-md border border-input bg-card text-sm text-foreground placeholder:text-muted-foreground transition-colors focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/25 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-danger";

export function Input({
  className,
  type = "text",
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(fieldBase, "h-9 px-3", className)}
      {...props}
    />
  );
}

export function Textarea({
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(fieldBase, "min-h-20 px-3 py-2 leading-relaxed", className)}
      {...props}
    />
  );
}

export function Label({
  className,
  ...props
}: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      data-slot="label"
      className={cn("text-sm font-medium text-foreground", className)}
      {...props}
    />
  );
}

/** Checkbox (or radio, via `type="radio"`) with a label and optional description. */
export function Checkbox({
  label,
  description,
  className,
  type = "checkbox",
  ...props
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, "children"> & {
  label: React.ReactNode;
  description?: React.ReactNode;
}) {
  return (
    <label className={cn("flex cursor-pointer items-start gap-3", props.disabled && "cursor-not-allowed opacity-60", className)}>
      <input
        type={type}
        className="mt-0.5 size-4 shrink-0 cursor-pointer accent-primary disabled:cursor-not-allowed"
        {...props}
      />
      <span className="min-w-0">
        <span className="block text-sm font-medium text-foreground">{label}</span>
        {description ? (
          <span className="block text-xs text-muted-foreground">{description}</span>
        ) : null}
      </span>
    </label>
  );
}

/** Label + control + optional hint/error, stacked. */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  className,
  children,
}: {
  label: React.ReactNode;
  htmlFor?: string;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error ? (
        <p className="text-xs text-danger">{error}</p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}
