"use client";
import { itemHref } from "@/app/lib/areas";
import { useState } from "react";
import Link from "next/link";
import toast from "react-hot-toast";
import { ArrowRight, CheckCircle2, ClipboardCheck, PenLine } from "lucide-react";
import { Button, Card, Checkbox, Textarea, cn } from "@logixai/ui";
import MathMarkdown from "@/app/components/MathMarkdown";
import { arenaApi } from "@/app/lib/api/arena";

/** Matches the server's minimum (DESIGN_MIN_CHARS in arena-service). */
const MIN_CHARS = 200;

const draftKey = (id) => `arena-design:${id}`;
function readDraft(id) {
  try {
    return window.localStorage.getItem(draftKey(id));
  } catch {
    return null;
  }
}
function writeDraft(id, text) {
  try {
    window.localStorage.setItem(draftKey(id), text);
  } catch {
    // Storage unavailable: the server keeps the submitted version.
  }
}

const words = (text) => (text.trim() ? text.trim().split(/\s+/).length : 0);

/**
 * Design questions: the learner writes a design, then sees the rubric and a
 * model answer and ticks the points they covered (no automatic grading).
 */
export default function DesignPlayer({ item, signedIn, onItemChange, inSession = false }) {
  const [text, setText] = useState(() => readDraft(item.id) ?? item.lastAnswer?.text ?? "");
  const [checked, setChecked] = useState(() => (Array.isArray(item.lastAnswer?.checked) ? item.lastAnswer.checked : []));
  const [busy, setBusy] = useState(false);
  const rubric = item.rubric ?? null;
  const needed = rubric ? Math.ceil((item.passShare ?? 0.7) * rubric.length) : 0;
  const solved = item.status === "solved";

  const change = (value) => {
    setText(value);
    writeDraft(item.id, value);
  };

  const send = async (body, done) => {
    setBusy(true);
    try {
      const res = await arenaApi.answer(item.id, body);
      done(res);
      onItemChange(await arenaApi.item(item.id));
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const submitDesign = () =>
    send({ text }, () => toast.success(rubric ? "Design updated." : "Submitted — now check it against the rubric."));

  const submitCheck = () =>
    send({ text, checked }, (res) => {
      if (res.correct) toast.success(res.xpGained ? `Solved! +${res.xpGained} XP` : "Self-check saved — solved.");
      else toast(`Saved. Covering ${needed} of ${rubric.length} points counts as solved — revise and check again.`);
    });

  const reveal = async () => {
    if (!window.confirm("Show the rubric and model answer without writing a design? You won't earn XP for this item.")) return;
    try {
      onItemChange(await arenaApi.reveal(item.id));
    } catch (err) {
      toast.error(err.message);
    }
  };

  const toggle = (id) => setChecked((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
  const tooShort = text.trim().length < MIN_CHARS;

  return (
    <div className="space-y-6">
      <Card className="space-y-3 p-5">
        <h2 className="flex items-center gap-2 font-semibold">
          <PenLine className="size-4" />
          Your design
        </h2>
        <p className="text-sm text-muted-foreground">
          Write it as you would explain it in an interview: requirements and numbers, components, data, the trade-offs you chose, and what
          happens when things fail. Plain text or Markdown.
        </p>
        <Textarea
          value={text}
          onChange={(e) => change(e.target.value)}
          rows={14}
          className="font-mono text-[13px]"
          placeholder={"Requirements: ...\nEstimates: ...\nDesign: ...\nTrade-offs: ...\nFailures: ..."}
          aria-label="Your design"
        />
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs text-muted-foreground">
            {words(text)} words{tooShort ? ` · at least ${MIN_CHARS} characters to submit` : ""}
          </span>
          {signedIn ? (
            <>
              <Button variant={rubric ? "secondary" : "primary"} size="sm" className="ml-auto" disabled={busy || tooShort} onClick={submitDesign}>
                {rubric ? "Save changes" : "Submit and see the rubric"}
              </Button>
              {!rubric && !inSession ? (
                <Button variant="ghost" size="sm" onClick={reveal}>
                  Show model answer
                </Button>
              ) : null}
            </>
          ) : (
            <Button asChild variant="primary" size="sm" className="ml-auto">
              <Link href={`/login?next=${itemHref(item.area, item.id)}`}>Sign in to submit</Link>
            </Button>
          )}
        </div>
      </Card>

      {rubric ? (
        <Card className="space-y-4 p-5">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="flex items-center gap-2 font-semibold">
              <ClipboardCheck className="size-4" />
              Check your design
            </h2>
            <span className={cn("ml-auto text-sm font-medium", checked.length >= needed ? "text-success" : "text-muted-foreground")}>
              {checked.filter((id) => rubric.some((r) => r.id === id)).length} of {rubric.length} covered · {needed} to pass
            </span>
          </div>
          <p className="text-sm text-muted-foreground">Tick the points your design covers — honestly; nobody else sees this.</p>
          <div className="space-y-3">
            {rubric.map((r) => (
              <Checkbox
                key={r.id}
                checked={checked.includes(r.id)}
                onChange={() => toggle(r.id)}
                label={r.point}
                description={r.detail}
                disabled={!signedIn || item.status === "revealed"}
              />
            ))}
          </div>
          {signedIn && item.status !== "revealed" ? (
            <Button variant="primary" size="sm" disabled={busy || tooShort} onClick={submitCheck}>
              <CheckCircle2 />
              Save self-check
            </Button>
          ) : null}
          {solved ? (
            <p className="flex items-center gap-2 text-sm font-semibold text-success">
              <CheckCircle2 className="size-4" /> Solved
            </p>
          ) : null}
        </Card>
      ) : null}

      {item.modelAnswer ? (
        <Card className="space-y-3 p-5">
          <details open={solved || item.status === "revealed"}>
            <summary className="cursor-pointer font-semibold">Model answer</summary>
            <div className="mt-3">
              <MathMarkdown>{item.modelAnswer}</MathMarkdown>
            </div>
          </details>
          {item.explanation ? (
            <div className="rounded-lg bg-muted p-4 text-sm">
              <p className="mb-1 font-semibold">What interviewers look for</p>
              <MathMarkdown>{item.explanation}</MathMarkdown>
            </div>
          ) : null}
          {item.nextItem ? (
            <Button asChild size="sm">
              <Link href={itemHref(item.area, item.nextItem.id)}>
                Next: {item.nextItem.title}
                <ArrowRight />
              </Link>
            </Button>
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}
