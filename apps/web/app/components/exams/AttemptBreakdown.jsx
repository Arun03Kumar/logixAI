"use client";
import { useState } from "react";
import { Check, MessageSquare, X } from "lucide-react";
import { Badge, Button, Card, Spinner, Textarea, cn } from "@logixai/ui";
import { LANGUAGES } from "@logixai/languages";
import Markdown from "@/app/coding-platform/components/Markdown";
import FormError from "@/app/components/forms/FormError";
import { QUESTION_TYPE, countWords, formatDateTime, isWritten } from "@/app/lib/exams/format";

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
      {question.negativeMarks ? (
        <li className="text-xs text-muted-foreground">Wrong answers lose {question.negativeMarks}; blank answers lose nothing.</li>
      ) : null}
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

/** A written answer: the text, then (when given) the rubric ticks and the model answer. */
export function WrittenDetail({ question }) {
  const text = question.answer?.text ?? "";
  const ticked = new Set(question.grade?.rubricIds ?? []);
  return (
    <div className="space-y-3">
      {text.trim() ? (
        <div className="rounded-md border border-border bg-muted/40 px-4 py-3 text-sm whitespace-pre-wrap">{text}</div>
      ) : (
        <p className="text-sm text-muted-foreground">Not answered.</p>
      )}
      {text.trim() ? <p className="text-xs text-muted-foreground">{countWords(text)} words</p> : null}
      {question.rubric?.length ? (
        <div>
          <p className="text-sm font-medium">Rubric</p>
          <ul className="mt-1 space-y-1">
            {question.rubric.map((r) => (
              <li key={r.id} className="flex items-start gap-2 text-sm">
                {question.grade ? (
                  ticked.has(r.id) ? (
                    <Check className="mt-0.5 size-4 shrink-0 text-success" />
                  ) : (
                    <X className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  )
                ) : (
                  <span className="mt-0.5 inline-block size-4 shrink-0" />
                )}
                <span className="flex-1">{r.label}</span>
                <span className="text-xs text-muted-foreground">{r.marks}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {question.modelAnswer?.trim() ? (
        <details className="rounded-md border border-border px-4 py-2 text-sm">
          <summary className="cursor-pointer font-medium">Model answer</summary>
          <div className="mt-2">
            <Markdown>{question.modelAnswer}</Markdown>
          </div>
        </details>
      ) : null}
    </div>
  );
}

function GradeNote({ grade }) {
  if (!grade?.comment) return null;
  return (
    <div className="flex items-start gap-2 rounded-md bg-info-soft px-3 py-2 text-sm">
      <MessageSquare className="mt-0.5 size-4 shrink-0 text-info" />
      <p className="whitespace-pre-wrap">{grade.comment}</p>
    </div>
  );
}

const REQUEST_STATUS = {
  open: { label: "Re-check requested", tone: "warning" },
  resolved: { label: "Re-checked", tone: "success" },
};

/** The student's re-check request for one question: its status, or a form to ask. */
function Reevaluation({ question, canRequest, onRequest, staff }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const request = question.reevaluation;

  if (request) {
    return (
      <div className="space-y-1 rounded-md border border-border px-3 py-2 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={REQUEST_STATUS[request.status].tone}>{REQUEST_STATUS[request.status].label}</Badge>
          <span className="text-xs text-muted-foreground">{formatDateTime(request.requestedAt)}</span>
          {request.status === "resolved" && request.scoreBefore !== request.scoreAfter ? (
            <span className="text-xs font-medium">
              {request.scoreBefore ?? "—"} → {request.scoreAfter ?? "—"}
            </span>
          ) : null}
        </div>
        <p className="text-muted-foreground">
          {staff ? "Student asked" : "You asked"}: {request.reason}
        </p>
        {request.response ? <p>Reply: {request.response}</p> : null}
      </div>
    );
  }
  if (!canRequest) return null;
  if (!open) {
    return (
      <Button size="sm" variant="ghost" className="px-0" onClick={() => setOpen(true)}>
        Ask for a re-check
      </Button>
    );
  }
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await onRequest(question.questionId, reason.trim());
      setOpen(false);
    } catch (err) {
      setError(err.fieldErrors?.reason ?? err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-2 rounded-md border border-border p-3">
      <FormError message={error} />
      <Textarea
        aria-label="What should be re-checked?"
        placeholder="Say what you think was marked wrongly, and why."
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        className="min-h-20"
      />
      <div className="flex gap-2">
        <Button size="sm" variant="primary" disabled={busy || reason.trim().length < 5} onClick={submit}>
          {busy ? <Spinner className="text-primary-foreground" /> : null}
          Send request
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">You can ask once per question.</p>
    </div>
  );
}

function QuestionCard({ q, number, actions, canRequest, onRequest }) {
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-3">
        <p className="text-sm font-semibold">Question {number}</p>
        <Badge>{QUESTION_TYPE[q.type]}</Badge>
        {q.grade && !isWritten(q.type) ? <Badge tone="info">Marked by a grader</Badge> : null}
        <span className="ml-auto">
          {q.awaitingGrading ? (
            <Badge tone="warning">Awaiting grading · {q.marks}</Badge>
          ) : (
            <Badge tone={scoreTone(q.score, q.marks)}>
              {q.score === null ? "—" : q.score} / {q.marks}
            </Badge>
          )}
        </span>
      </div>
      <div className="space-y-4 p-5">
        <Markdown>{q.prompt}</Markdown>
        {q.options ? <McqDetail question={q} /> : null}
        {q.type === "coding" && q.answer !== undefined ? <CodingDetail question={q} /> : null}
        {isWritten(q.type) && (q.answer !== undefined || q.rubric) ? <WrittenDetail question={q} /> : null}
        <GradeNote grade={q.grade} />
        {onRequest || q.reevaluation ? (
          <Reevaluation question={q} canRequest={canRequest} onRequest={onRequest} staff={Boolean(actions)} />
        ) : null}
        {actions ? actions(q) : null}
      </div>
    </Card>
  );
}

const subtotal = (questions) => {
  const scored = questions.filter((q) => q.score !== null && q.score !== undefined);
  return {
    score: Math.round(scored.reduce((s, q) => s + q.score, 0) * 100) / 100,
    max: questions.reduce((s, q) => s + q.marks, 0),
    complete: scored.length === questions.length,
  };
};

/**
 * Question-by-question view of an attempt (student result or staff review),
 * grouped by section with subtotals.
 * - onRequest(questionId, reason): students asking for a re-check (when allowed).
 * - actions(question): extra controls under each question (staff grading).
 */
export default function AttemptBreakdown({ result, onRequest, actions }) {
  const sections = result.sections ?? [];
  const known = new Set(sections.map((s) => s.id));
  const groups = [
    { section: null, questions: result.questions.filter((q) => !q.sectionId || !known.has(q.sectionId)) },
    ...sections.map((s) => ({ section: s, questions: result.questions.filter((q) => q.sectionId === s.id) })),
  ].filter((g) => g.questions.length);
  const number = new Map(result.questions.map((q, i) => [q.questionId, i + 1]));
  const canRequest = Boolean(result.reevaluation?.open && onRequest);

  return (
    <div className="space-y-6">
      {groups.map(({ section, questions }) => {
        const sub = subtotal(questions);
        return (
          <section key={section?.id ?? "none"} className="space-y-4">
            {section ? (
              <div className="flex flex-wrap items-baseline gap-x-3 border-b border-border pb-2">
                <h2 className="text-base font-semibold">{section.title}</h2>
                {section.instructions ? <p className="text-sm text-muted-foreground">{section.instructions}</p> : null}
                <span className="ml-auto text-sm font-medium tabular-nums">
                  {sub.complete ? sub.score : "—"} / {sub.max}
                </span>
              </div>
            ) : null}
            {questions.map((q) => (
              <QuestionCard
                key={q.questionId}
                q={q}
                number={number.get(q.questionId)}
                actions={actions}
                canRequest={canRequest}
                onRequest={onRequest}
              />
            ))}
          </section>
        );
      })}
    </div>
  );
}
