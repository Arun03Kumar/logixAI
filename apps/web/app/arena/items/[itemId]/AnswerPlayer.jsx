"use client";
import { useState } from "react";
import Link from "next/link";
import toast from "react-hot-toast";
import { ArrowRight, CheckCircle2, Lightbulb, XCircle } from "lucide-react";
import { Button, Card, Input, Textarea, cn } from "@logixai/ui";
import MathMarkdown from "@/app/components/MathMarkdown";
import { arenaApi } from "@/app/lib/api/arena";

function Options({ item, selected, onChange, correctIds, disabled }) {
  const single = item.type === "mcq_single";
  const toggle = (id) =>
    onChange(single ? [id] : selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]);
  return (
    <fieldset className="space-y-2" disabled={disabled}>
      <legend className="mb-2 text-sm text-muted-foreground">{single ? "Choose one." : "Choose all that apply."}</legend>
      {item.options.map((option, i) => {
        const checked = selected.includes(option.id);
        const correct = correctIds?.includes(option.id);
        return (
          <label
            key={option.id}
            className={cn(
              "flex cursor-pointer items-start gap-3 rounded-lg border px-4 py-3 text-sm transition-colors",
              correct
                ? "border-success bg-success-soft"
                : checked
                  ? "border-primary bg-primary-soft"
                  : "border-border bg-card hover:bg-accent",
            )}
          >
            <input
              type={single ? "radio" : "checkbox"}
              name={`item-${item.id}`}
              checked={checked}
              onChange={() => toggle(option.id)}
              className="mt-1 size-4 shrink-0 accent-primary"
            />
            <span className="flex min-w-0 gap-2">
              <span className="font-semibold text-muted-foreground">{String.fromCharCode(65 + i)}.</span>
              <MathMarkdown inline>{option.text}</MathMarkdown>
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}

function initialAnswer(item) {
  const last = item.lastAnswer ?? {};
  return {
    selected: Array.isArray(last.selectedOptionIds) ? last.selectedOptionIds : [],
    value: typeof last.value === "number" ? String(last.value) : "",
    text: typeof last.text === "string" ? last.text : "",
  };
}

/** Multiple choice, numeric and predict-the-output items: graded instantly. */
export default function AnswerPlayer({ item, signedIn, onItemChange }) {
  const [answer, setAnswer] = useState(() => initialAnswer(item));
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [hints, setHints] = useState(0);
  const open = item.status === "solved" || item.status === "revealed";

  const payload = () => {
    if (item.type === "mcq_single" || item.type === "mcq_multi") return { selectedOptionIds: answer.selected };
    if (item.type === "numeric") return { value: Number(answer.value) };
    return { text: answer.text };
  };
  const ready =
    item.type === "numeric"
      ? answer.value.trim() !== "" && Number.isFinite(Number(answer.value))
      : item.type === "output"
        ? answer.text.trim() !== ""
        : answer.selected.length > 0;

  const check = async () => {
    setBusy(true);
    try {
      const res = await arenaApi.answer(item.id, payload());
      setResult(res);
      if (res.correct) {
        onItemChange(await arenaApi.item(item.id));
        if (res.xpGained) toast.success(`Correct! +${res.xpGained} XP`);
      }
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const reveal = async () => {
    if (!window.confirm("Show the answer? You won't earn XP for this item, but you can still practise it.")) return;
    try {
      onItemChange(await arenaApi.reveal(item.id));
    } catch (err) {
      toast.error(err.message);
    }
  };

  const correctIds = open && Array.isArray(item.answer) ? item.answer : null;

  return (
    <div className="space-y-6">
      {item.snippet ? (
        <pre className="overflow-x-auto rounded-lg border border-border bg-muted p-4 font-mono text-sm">
          <code>{item.snippet}</code>
        </pre>
      ) : null}

      <Card className="space-y-4 p-5">
        {item.type === "mcq_single" || item.type === "mcq_multi" ? (
          <Options
            item={item}
            selected={answer.selected}
            onChange={(selected) => setAnswer((a) => ({ ...a, selected }))}
            correctIds={correctIds}
          />
        ) : item.type === "numeric" ? (
          <div className="space-y-2">
            <label htmlFor="numeric-answer" className="text-sm font-medium">
              Your answer{item.answerFormat ? ` (${item.answerFormat})` : ""}
            </label>
            <Input
              id="numeric-answer"
              inputMode="decimal"
              className="max-w-xs font-mono"
              value={answer.value}
              onChange={(e) => setAnswer((a) => ({ ...a, value: e.target.value }))}
              onKeyDown={(e) => e.key === "Enter" && ready && signedIn && check()}
            />
          </div>
        ) : (
          <div className="space-y-2">
            <label htmlFor="output-answer" className="text-sm font-medium">
              What does it print?
            </label>
            <Textarea
              id="output-answer"
              rows={4}
              spellCheck={false}
              className="font-mono"
              value={answer.text}
              onChange={(e) => setAnswer((a) => ({ ...a, text: e.target.value }))}
            />
          </div>
        )}

        {result && !result.correct ? (
          <p className="flex items-center gap-2 text-sm font-medium text-danger" role="status">
            <XCircle className="size-4" />
            Not quite. Try again{item.hints.length > hints ? ", or take a hint" : ""}.
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          {signedIn ? (
            <Button variant="primary" onClick={check} disabled={!ready || busy}>
              {busy ? "Checking…" : "Check answer"}
            </Button>
          ) : (
            <Button asChild variant="primary">
              <Link href={`/login?next=/arena/items/${item.id}`}>Sign in to answer</Link>
            </Button>
          )}
          {item.hints.length > hints ? (
            <Button variant="ghost" onClick={() => setHints((h) => h + 1)}>
              <Lightbulb />
              {hints ? "Another hint" : "Hint"}
            </Button>
          ) : null}
          {signedIn && !open ? (
            <Button variant="ghost" onClick={reveal} className="ml-auto">
              Show answer
            </Button>
          ) : null}
        </div>
      </Card>

      {hints > 0 ? (
        <div className="space-y-2">
          {item.hints.slice(0, hints).map((hint, i) => (
            <div key={i} className="flex gap-3 rounded-lg bg-info-soft px-4 py-3 text-sm">
              <Lightbulb className="mt-0.5 size-4 shrink-0 text-info" />
              <MathMarkdown inline>{hint}</MathMarkdown>
            </div>
          ))}
        </div>
      ) : null}

      {open ? (
        <Card className="space-y-3 border-success p-5">
          <p className="flex items-center gap-2 font-semibold text-success">
            <CheckCircle2 className="size-4" />
            {item.status === "solved" ? "Solved" : "Answer"}
          </p>
          {!Array.isArray(item.answer) && item.answer !== undefined ? (
            <pre className="overflow-x-auto rounded-md bg-muted px-3 py-2 font-mono text-sm">{item.answer}</pre>
          ) : null}
          <MathMarkdown>{item.explanation}</MathMarkdown>
          {item.nextItem ? (
            <Button asChild size="sm">
              <Link href={`/arena/items/${item.nextItem.id}`}>
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
