"use client";
import { Check, X } from "lucide-react";
import { Badge, Card, cn } from "@logixai/ui";
import { LANGUAGES } from "@logixai/languages";
import Markdown from "@/app/coding-platform/components/Markdown";
import { QUESTION_TYPE } from "@/app/lib/exams/format";

function scoreTone(score, marks) {
  if (score === null || score === undefined) return "neutral";
  if (score >= marks) return "success";
  return score > 0 ? "warning" : "danger";
}

function McqDetail({ question }) {
  const selected = question.answer?.selectedOptionIds ?? [];
  return (
    <ul className="space-y-1.5">
      {question.options.map((option, i) => {
        const correct = question.correctOptionIds.includes(option.id);
        const chosen = selected.includes(option.id);
        return (
          <li
            key={option.id}
            className={cn(
              "flex items-start gap-2 rounded-md border px-3 py-2 text-sm",
              correct ? "border-success/40 bg-success-soft" : chosen ? "border-danger/40 bg-danger-soft" : "border-border",
            )}
          >
            <span className="mt-0.5 shrink-0">
              {correct ? <Check className="size-4 text-success" /> : chosen ? <X className="size-4 text-danger" /> : <span className="inline-block size-4" />}
            </span>
            <span className="flex-1">
              <span className="mr-2 font-semibold text-muted-foreground">{String.fromCharCode(65 + i)}.</span>
              {option.text}
            </span>
            {chosen ? <span className="text-xs text-muted-foreground">Selected</span> : null}
          </li>
        );
      })}
      {selected.length === 0 ? <li className="text-sm text-muted-foreground">Not answered.</li> : null}
    </ul>
  );
}

function CodingDetail({ question }) {
  const answer = question.answer;
  if (!answer?.code?.trim()) return <p className="text-sm text-muted-foreground">Not answered.</p>;
  const judge = answer.judge;
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm">
        <Badge tone="outline">{LANGUAGES[answer.language]?.label ?? answer.language}</Badge>
        {judge ? (
          <span className="text-muted-foreground">
            {judge.status === "pending" ? "Being judged…" : `${judge.passed} of ${judge.total} tests passed`}
          </span>
        ) : null}
      </div>
      <pre className="max-h-80 overflow-auto rounded-md bg-[#1e1e1e] p-4 font-mono text-[13px] leading-6 text-[#d4d4d4]">
        {answer.code}
      </pre>
      {judge?.message ? (
        <pre className="max-h-28 overflow-auto rounded-md bg-muted px-3 py-2 font-mono text-xs text-danger whitespace-pre-wrap">
          {judge.message}
        </pre>
      ) : null}
    </div>
  );
}

/** Question-by-question view of an attempt (student result or instructor review). */
export default function AttemptBreakdown({ result }) {
  return (
    <div className="space-y-4">
      {result.questions.map((q, i) => (
        <Card key={q.questionId}>
          <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-3">
            <p className="text-sm font-semibold">Question {i + 1}</p>
            <Badge>{QUESTION_TYPE[q.type]}</Badge>
            <span className="ml-auto">
              <Badge tone={scoreTone(q.score, q.marks)}>
                {q.score === null ? "—" : q.score} / {q.marks}
              </Badge>
            </span>
          </div>
          <div className="space-y-4 p-5">
            <Markdown>{q.prompt}</Markdown>
            {q.options ? <McqDetail question={q} /> : null}
            {q.type === "coding" && q.answer !== undefined ? <CodingDetail question={q} /> : null}
          </div>
        </Card>
      ))}
    </div>
  );
}
