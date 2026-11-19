"use client";
import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import toast from "react-hot-toast";
import { CheckCircle2, ChevronLeft, MessageSquareWarning } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  Checkbox,
  Container,
  EmptyState,
  Input,
  Skeleton,
  Spinner,
  Tabs,
  Textarea,
  cn,
} from "@logixai/ui";
import Markdown from "@/app/coding-platform/components/Markdown";
import AppHeader from "@/app/components/layout/AppHeader";
import RequireAuth from "@/app/components/layout/RequireAuth";
import LoadMore from "@/app/components/LoadMore";
import FormError from "@/app/components/forms/FormError";
import GradeForm from "@/app/components/exams/GradeForm";
import { examApi } from "@/app/lib/api/exams";
import { useApi } from "@/app/lib/api/useApi";
import { usePagedApi } from "@/app/lib/api/usePagedApi";
import { QUESTION_TYPE, countWords, formatDateTime } from "@/app/lib/exams/format";

const RECHECKS = "rechecks";
const preview = (prompt) => (prompt ?? "").replace(/[#*_`>]/g, "").trim().split("\n")[0] || "(no question text)";

function Progress({ done, total }) {
  const pct = total ? Math.round((done / total) * 100) : 100;
  return (
    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
      <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
    </div>
  );
}

/** Answers to one written question, oldest submission first. */
function Queue({ examId, question, onGraded }) {
  const [show, setShow] = useState("ungraded");
  const [blind, setBlind] = useState(false);
  const queue = usePagedApi(
    (cursor) => examApi.gradingQueue(examId, question.questionId, { show, cursor }),
    [examId, question.questionId, show],
  );
  const full = queue.data?.question;

  const saved = (item, res, wasGraded) => {
    if (show === "ungraded") queue.setItems((items) => items.filter((x) => x.attemptId !== item.attemptId));
    else queue.setItems((items) => items.map((x) => (x.attemptId === item.attemptId ? { ...x, grade: res.grade } : x)));
    if (!wasGraded && res.grade) onGraded(question.questionId);
  };

  return (
    <div className="space-y-4">
      <Card className="space-y-3 p-5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge>{QUESTION_TYPE[question.type]}</Badge>
          <Badge tone="outline">{question.marks} marks</Badge>
        </div>
        <Markdown>{question.prompt}</Markdown>
        {full?.modelAnswer?.trim() ? (
          <details className="rounded-md border border-border px-4 py-2 text-sm">
            <summary className="cursor-pointer font-medium">Model answer</summary>
            <div className="mt-2">
              <Markdown>{full.modelAnswer}</Markdown>
            </div>
          </details>
        ) : null}
      </Card>

      <div className="flex flex-wrap items-center gap-4">
        <Tabs
          size="sm"
          aria-label="Which answers"
          items={[
            { value: "ungraded", label: "To grade" },
            { value: "all", label: "All answers" },
          ]}
          value={show}
          onValueChange={setShow}
        />
        <Checkbox label="Hide names" checked={blind} onChange={(e) => setBlind(e.target.checked)} />
      </div>

      {queue.loading ? (
        <Skeleton className="h-40 w-full" />
      ) : queue.error ? (
        <Card>
          <EmptyState title="Couldn't load answers" description={queue.error.message} />
        </Card>
      ) : queue.items.length === 0 ? (
        <Card>
          <EmptyState
            icon={<CheckCircle2 />}
            title={show === "ungraded" ? "All caught up" : "No answers yet"}
            description={
              show === "ungraded"
                ? "Every submitted answer to this question has marks. Blank answers score 0 on their own."
                : "Answers appear here once students submit."
            }
          />
        </Card>
      ) : (
        <div className="space-y-4">
          {queue.items.map((item, i) => (
            <Card key={item.attemptId} className="overflow-hidden">
              <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-3 text-sm">
                <span className="font-semibold">
                  {blind ? `Answer ${i + 1}` : [item.name, item.rollNumber].filter(Boolean).join(" · ")}
                </span>
                {item.grade ? <Badge tone="success">{item.grade.marks} / {question.marks}</Badge> : null}
                {item.reevaluation ? <Badge tone="warning">Re-check requested</Badge> : null}
                <span className="ml-auto text-xs text-muted-foreground">{countWords(item.answer.text)} words</span>
              </div>
              <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
                <div className="space-y-3">
                  <div className="max-h-96 overflow-y-auto rounded-md bg-muted/40 px-4 py-3 text-sm whitespace-pre-wrap">
                    {item.answer.text}
                  </div>
                  {item.reevaluation ? (
                    <p className="text-sm text-muted-foreground">Student asked: {item.reevaluation.reason}</p>
                  ) : null}
                </div>
                {full ? (
                  <GradeForm
                    key={item.grade?.gradedAt ?? "new"}
                    examId={examId}
                    attemptId={item.attemptId}
                    question={{ ...full, questionId: full.id }}
                    grade={item.grade}
                    onSaved={(res) => saved(item, res, Boolean(item.grade))}
                  />
                ) : null}
              </div>
            </Card>
          ))}
        </div>
      )}
      <LoadMore list={queue} label="More answers" />
    </div>
  );
}

function ResolveForm({ examId, request, onResolved }) {
  const [response, setResponse] = useState("");
  const [marks, setMarks] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const value = marks === "" ? undefined : Number(marks);
  const valid = value === undefined || (Number.isFinite(value) && value >= 0 && value <= request.questionMarks);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const row = await examApi.resolveReevaluation(examId, request.id, {
        response: response.trim(),
        ...(value === undefined ? {} : { marks: value }),
      });
      toast.success("Reply sent to the student.");
      onResolved(row);
    } catch (err) {
      setError(err.fieldErrors?.response ?? err.message);
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-2">
      <FormError message={error} />
      <Textarea
        aria-label="Reply to the student"
        placeholder="Reply to the student"
        value={response}
        onChange={(e) => setResponse(e.target.value)}
        className="min-h-16"
      />
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-sm">
          New marks
          <Input
            type="number"
            min={0}
            max={request.questionMarks}
            step="0.25"
            placeholder={request.currentScore ?? "—"}
            value={marks}
            onChange={(e) => setMarks(e.target.value)}
            className="h-9 w-24"
          />
          <span className="text-muted-foreground">/ {request.questionMarks} (leave empty to keep)</span>
        </label>
        <Button type="submit" size="sm" variant="primary" className="ml-auto" disabled={busy || !response.trim() || !valid}>
          {busy ? <Spinner className="text-primary-foreground" /> : null}
          Send reply
        </Button>
      </div>
    </form>
  );
}

function Rechecks({ institutionId, examId, onResolved }) {
  const [status, setStatus] = useState("open");
  const list = useApi(() => examApi.reevaluations(examId, status), [examId, status]);
  const rows = list.data ?? [];
  return (
    <div className="space-y-4">
      <Tabs
        size="sm"
        aria-label="Requests"
        items={[
          { value: "open", label: "Waiting" },
          { value: "resolved", label: "Answered" },
        ]}
        value={status}
        onValueChange={setStatus}
      />
      {list.loading ? (
        <Skeleton className="h-32 w-full" />
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={<CheckCircle2 />}
            title={status === "open" ? "No requests waiting" : "No answered requests yet"}
            description="Students can ask for a re-check when the exam allows it (exam settings)."
          />
        </Card>
      ) : (
        rows.map((r) => (
          <Card key={r.id} className="space-y-3 p-5">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-semibold">{[r.name, r.rollNumber].filter(Boolean).join(" · ")}</span>
              <span className="text-muted-foreground">{formatDateTime(r.requestedAt)}</span>
              <Badge tone="outline" className="ml-auto">
                Now {r.currentScore ?? "—"} / {r.questionMarks}
              </Badge>
            </div>
            <p className="text-sm">
              <span className="text-muted-foreground">Question: </span>
              {preview(r.questionPrompt)}
            </p>
            <p className="rounded-md bg-warning-soft px-3 py-2 text-sm">{r.reason}</p>
            {r.status === "open" ? (
              <ResolveForm
                examId={examId}
                request={r}
                onResolved={(row) => {
                  list.setData((d) => d.filter((x) => x.id !== row.id));
                  onResolved();
                }}
              />
            ) : (
              <p className="text-sm">
                Replied: {r.response}
                {r.scoreBefore !== r.scoreAfter ? ` (${r.scoreBefore ?? "—"} → ${r.scoreAfter ?? "—"})` : ""}
              </p>
            )}
            <Button asChild size="sm" variant="ghost" className="px-0">
              <Link href={`/institutions/${institutionId}/exams/${examId}/attempts/${r.attemptId}`}>Open the full attempt</Link>
            </Button>
          </Card>
        ))
      )}
    </div>
  );
}

function Grading() {
  const { id: institutionId, examId } = useParams();
  const overview = useApi(() => examApi.gradingOverview(examId), [examId]);
  const [selected, setSelected] = useState(null);

  if (overview.loading) {
    return (
      <Container className="space-y-3 py-10">
        <Skeleton className="h-8 w-1/2" />
        <Skeleton className="h-40 w-full" />
      </Container>
    );
  }
  if (overview.error) {
    return (
      <Container className="py-16">
        <EmptyState title="Grading isn't available" description={overview.error.message} />
      </Container>
    );
  }

  const { exam, questions, openReevaluations } = overview.data;
  const current = selected ?? questions.find((q) => q.graded < q.answered)?.questionId ?? questions[0]?.questionId ?? RECHECKS;
  const question = questions.find((q) => q.questionId === current);
  const onGraded = (questionId) =>
    overview.setData((d) => ({
      ...d,
      questions: d.questions.map((q) => (q.questionId === questionId ? { ...q, graded: q.graded + 1 } : q)),
    }));

  return (
    <Container className="space-y-6 py-10">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href={`/institutions/${institutionId}/exams/${examId}/results`}>
          <ChevronLeft />
          Results
        </Link>
      </Button>
      <div>
        <h1 className="text-2xl font-semibold">Grade: {exam.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Written answers wait here for marks. Scores update as you save; students see them when results are released.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <nav aria-label="Questions to grade" className="space-y-2">
          {questions.map((q, i) => (
            <button
              key={q.questionId}
              type="button"
              onClick={() => setSelected(q.questionId)}
              aria-current={current === q.questionId ? "true" : undefined}
              className={cn(
                "w-full rounded-lg border px-3 py-2.5 text-left transition-colors",
                current === q.questionId ? "border-primary bg-primary-soft" : "border-border bg-card hover:bg-accent",
              )}
            >
              <p className="truncate text-sm font-medium">
                {i + 1}. {preview(q.prompt)}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {q.graded} of {q.answered} graded · {q.marks} marks
              </p>
              <Progress done={q.graded} total={q.answered} />
            </button>
          ))}
          <button
            type="button"
            onClick={() => setSelected(RECHECKS)}
            aria-current={current === RECHECKS ? "true" : undefined}
            className={cn(
              "flex w-full items-center gap-2 rounded-lg border px-3 py-2.5 text-left text-sm font-medium transition-colors",
              current === RECHECKS ? "border-primary bg-primary-soft" : "border-border bg-card hover:bg-accent",
            )}
          >
            <MessageSquareWarning className="size-4" />
            Re-check requests
            {openReevaluations ? <Badge tone="warning" className="ml-auto">{openReevaluations}</Badge> : null}
          </button>
          {questions.length === 0 ? (
            <p className="px-1 text-xs text-muted-foreground">
              This exam has no written questions. You can still change any answer&apos;s marks from the student&apos;s attempt page.
            </p>
          ) : null}
        </nav>

        <div className="min-w-0">
          {current === RECHECKS || !question ? (
            <Rechecks
              institutionId={institutionId}
              examId={examId}
              onResolved={() => overview.setData((d) => ({ ...d, openReevaluations: Math.max(0, d.openReevaluations - 1) }))}
            />
          ) : (
            <Queue key={question.questionId} examId={examId} question={question} onGraded={onGraded} />
          )}
        </div>
      </div>
    </Container>
  );
}

export default function GradePage() {
  return (
    <>
      <AppHeader />
      <RequireAuth>
        <Grading />
      </RequireAuth>
    </>
  );
}
