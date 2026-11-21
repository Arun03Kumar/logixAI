"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Clock, LogIn, Timer } from "lucide-react";
import { Badge, Button, Card, cn } from "@logixai/ui";

/** The current time, updated every `ms` (for countdowns). */
export function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/** "1:05:09" / "4:07" */
export function clock(msLeft) {
  const s = Math.max(0, Math.floor(msLeft / 1000));
  if (s >= 86_400) return `${Math.floor(s / 86_400)}d ${Math.floor((s % 86_400) / 3600)}h`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

const dateFmt = new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
export const when = (iso) => dateFmt.format(new Date(iso));

/** Time left in a session, red in the last five minutes. */
export function Countdown({ endsAt, className }) {
  const now = useNow();
  const left = new Date(endsAt).getTime() - now;
  return (
    <span className={cn("inline-flex items-center gap-1.5 font-mono tabular-nums", left < 5 * 60_000 && "text-danger", className)}>
      <Timer className="size-4" />
      {left > 0 ? clock(left) : "Time's up"}
    </span>
  );
}

/** Shown on an item page opened from a session (?session=ID). */
export function SessionBanner({ session }) {
  const solved = session.items.filter((i) => i.solved).length;
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-primary bg-primary-soft px-4 py-2.5 text-sm">
      <Badge tone="brand">{session.kind === "contest" ? "Contest" : "Mock interview"}</Badge>
      <span className="font-medium">{session.title}</span>
      <span className="text-muted-foreground">
        {solved} of {session.items.length} solved
      </span>
      {session.over ? <span className="text-muted-foreground">· ended</span> : <Countdown endsAt={session.endsAt} />}
      {!session.over ? <span className="text-xs text-muted-foreground">Solutions are hidden until it ends.</span> : null}
      <Button asChild size="sm" variant="secondary" className="ml-auto">
        <Link href={`/practice/session/${session.id}`}>{session.over ? "See the report" : "All questions"}</Link>
      </Button>
    </div>
  );
}

export function SignInPrompt({ next, what }) {
  return (
    <Card className="flex flex-col items-start gap-3 p-6">
      <p className="font-semibold">Sign in to {what}</p>
      <p className="text-sm text-muted-foreground">Your progress, reports and contest results are saved to your account.</p>
      <Button asChild variant="primary" size="sm">
        <Link href={`/login?next=${encodeURIComponent(next)}`}>
          <LogIn />
          Sign in
        </Link>
      </Button>
    </Card>
  );
}

export function Duration({ minutes }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <Clock className="size-3.5" />
      {minutes} min
    </span>
  );
}

export const VERDICT = {
  strong: { label: "Strong", tone: "success", text: "You'd likely pass this round. Keep the streak going with harder problems." },
  borderline: { label: "Borderline", tone: "warning", text: "Close. Practise the topics below, then try another mock." },
  "needs-work": { label: "Not yet", tone: "danger", text: "Work through the topics below before your next attempt." },
};
