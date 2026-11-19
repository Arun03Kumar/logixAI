"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { AlertTriangle, CheckCircle2, Clock, Maximize } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  Container,
  EmptyState,
  Logo,
  Skeleton,
  Spinner,
  cn,
} from "@logixai/ui";
import RequireAuth from "@/app/components/layout/RequireAuth";
import Markdown from "@/app/coding-platform/components/Markdown";
import { examApi } from "@/app/lib/api/exams";
import { useApi } from "@/app/lib/api/useApi";
import { formatCountdown, formatWindow } from "@/app/lib/exams/format";
import QuestionView from "./QuestionView";
import { exitFullscreen, useProctoring } from "./useProctoring";

const SAVE_DELAY_MS = 800;
const POLL_MS = 2000;

/* ── Before starting ─────────────────────────────────────────────────── */

function Intro({ exam, onStart, starting }) {
  const resuming = exam.myAttempt?.status === "in_progress";
  const rules = [
    `You have ${exam.durationMinutes} minutes once you start. The timer keeps running if you close the tab.`,
    "Answers save automatically. When time runs out, the exam is submitted for you.",
    exam.proctoring.requireFullscreen && "The exam runs in fullscreen. Leaving fullscreen is recorded.",
    "Switching tabs or windows is recorded and shared with your instructor.",
    exam.proctoring.blockCopyPaste && "Copy and paste are disabled.",
  ].filter(Boolean);

  return (
    <Container size="md" className="py-12">
      <Logo />
      <h1 className="mt-8 text-3xl font-bold">{exam.title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {exam.questionCount} questions · {exam.totalMarks} marks · {exam.durationMinutes} min ·{" "}
        Open {formatWindow(exam.startsAt, exam.endsAt)}
      </p>

      {exam.instructions ? (
        <Card className="mt-8 p-5">
          <h2 className="text-sm font-semibold">Instructions</h2>
          <Markdown className="mt-3">{exam.instructions}</Markdown>
        </Card>
      ) : null}

      <Card className="mt-4 p-5">
        <h2 className="text-sm font-semibold">Before you begin</h2>
        <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
          {rules.map((rule) => (
            <li key={rule} className="flex gap-2">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
              {rule}
            </li>
          ))}
        </ul>
      </Card>

      <div className="mt-8 flex items-center gap-3">
        <Button variant="primary" size="lg" onClick={onStart} disabled={starting}>
          {starting ? <Spinner className="text-primary-foreground" /> : null}
          {resuming ? "Resume exam" : "Start exam"}
        </Button>
        <Button asChild variant="ghost" size="lg">
          <Link href={`/institutions/${exam.institutionId}`}>Not now</Link>
        </Button>
      </div>
    </Container>
  );
}

/* ── After submitting ────────────────────────────────────────────────── */

function Submitted({ exam, auto }) {
  return (
    <Container size="md" className="py-16">
      <EmptyState
        icon={<CheckCircle2 />}
        title={auto ? "Time's up. Your exam was submitted." : "Exam submitted"}
        description="Your answers are saved. You can close this page."
        action={
          <div className="flex gap-2">
            <Button asChild variant="primary" size="sm">
              <Link href={`/exams/${exam.id}/result`}>View result</Link>
            </Button>
            <Button asChild size="sm">
              <Link href={`/institutions/${exam.institutionId}`}>Back to institution</Link>
            </Button>
          </div>
        }
      />
    </Container>
  );
}

/* ── Taking the exam ─────────────────────────────────────────────────── */

function Runner({ initial, onFinished }) {
  const [attempt, setAttempt] = useState(initial);
  const [answers, setAnswers] = useState(() => initial.answers);
  const [current, setCurrent] = useState(0);
  const [saveState, setSaveState] = useState("saved"); // saved | saving | error
  const [runningId, setRunningId] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  // Server time minus device time, so a wrong device clock can't stretch the timer.
  const [clockOffset] = useState(() => new Date(initial.serverNow).getTime() - Date.now());
  const remaining = new Date(attempt.deadline).getTime() - (now + clockOffset);

  const timers = useRef({});
  const pending = useRef({});
  const finished = useRef(false);

  const { eventCount, fullscreenLost, enterFullscreen } = useProctoring({
    attemptId: attempt.id,
    active: attempt.status === "in_progress",
    requireFullscreen: attempt.exam.settings.requireFullscreen,
    blockCopyPaste: attempt.exam.settings.blockCopyPaste,
    initialCount: attempt.proctorEventCount,
  });

  const finish = useCallback(
    (auto) => {
      if (finished.current) return;
      finished.current = true;
      exitFullscreen();
      onFinished(auto);
    },
    [onFinished],
  );

  const flushOne = useCallback(
    async (questionId) => {
      clearTimeout(timers.current[questionId]);
      const body = pending.current[questionId];
      if (!body) return;
      delete pending.current[questionId];
      try {
        await examApi.saveAnswer(attempt.id, questionId, body);
        if (Object.keys(pending.current).length === 0) setSaveState("saved");
      } catch (err) {
        if (err.status === 409) {
          finish(true);
          return;
        }
        pending.current[questionId] = { ...body, ...pending.current[questionId] };
        setSaveState("error");
      }
    },
    [attempt.id, finish],
  );

  const flushAll = useCallback(
    () => Promise.all(Object.keys(pending.current).map((id) => flushOne(id))),
    [flushOne],
  );

  const onAnswer = (questionId, patch) => {
    setAnswers((a) => ({ ...a, [questionId]: { ...a[questionId], ...patch } }));
    pending.current[questionId] = { ...pending.current[questionId], ...patch };
    setSaveState("saving");
    clearTimeout(timers.current[questionId]);
    timers.current[questionId] = setTimeout(() => flushOne(questionId), SAVE_DELAY_MS);
  };

  const submit = useCallback(
    async (auto = false) => {
      setSubmitting(true);
      await flushAll().catch(() => {});
      try {
        await examApi.submit(attempt.id);
      } catch {
        // Already submitted (e.g. by the server sweep): still finish.
      }
      finish(auto);
    },
    [attempt.id, finish, flushAll],
  );

  // Timer tick; auto-submit at zero.
  useEffect(() => {
    const id = setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (new Date(attempt.deadline).getTime() - (t + clockOffset) <= 0) {
        clearInterval(id);
        submit(true);
      }
    }, 1000);
    return () => clearInterval(id);
  }, [attempt.deadline, clockOffset, submit]);

  // While any coding answer is being judged, poll for the result.
  const judging = Object.values(answers).some((a) => a?.judge?.status === "pending");
  useEffect(() => {
    if (!judging) return undefined;
    const id = setInterval(async () => {
      try {
        const fresh = await examApi.attempt(attempt.id);
        setAnswers((a) => {
          const next = { ...a };
          for (const [qid, ans] of Object.entries(fresh.answers)) {
            if (ans.judge) next[qid] = { ...next[qid], judge: ans.judge };
          }
          return next;
        });
      } catch {
        // keep polling
      }
    }, POLL_MS);
    return () => clearInterval(id);
  }, [judging, attempt.id]);

  const run = async (questionId) => {
    setRunningId(questionId);
    try {
      await flushOne(questionId);
      const fresh = await examApi.run(attempt.id, questionId);
      setAttempt(fresh);
      setAnswers((a) => ({ ...a, [questionId]: { ...a[questionId], judge: fresh.answers[questionId]?.judge } }));
    } catch (err) {
      toast.error(err.message);
    } finally {
      setRunningId(null);
    }
  };

  const questions = attempt.questions;
  const isAnswered = (q) => {
    const a = answers[q.id];
    if (q.type === "coding") return Boolean(a?.code?.trim());
    if (q.type === "short_answer" || q.type === "long_answer") return Boolean(a?.text?.trim());
    return (a?.selectedOptionIds?.length ?? 0) > 0;
  };
  const sections = new Map((attempt.exam.sections ?? []).map((s) => [s.id, s]));
  const sectionOf = (q) => (q?.sectionId ? sections.get(q.sectionId) : undefined);
  const unanswered = questions.filter((q) => !isAnswered(q)).length;

  const confirmSubmit = () => {
    const note = unanswered ? `${unanswered} question(s) are unanswered. ` : "";
    if (window.confirm(`${note}Submit your exam? You can't change answers afterwards.`)) submit(false);
  };

  const question = questions[current];
  const lowTime = remaining < 5 * 60_000;

  return (
    <div className="flex h-screen flex-col bg-background">
      <header className="flex h-14 shrink-0 items-center gap-4 border-b border-border px-4">
        <Logo showMark className="text-[15px]" />
        <span className="hidden h-5 w-px bg-border sm:block" aria-hidden="true" />
        <h1 className="min-w-0 flex-1 truncate text-sm font-semibold">{attempt.exam.title}</h1>
        <span className="hidden text-xs text-muted-foreground sm:inline" aria-live="polite">
          {saveState === "saving" ? "Saving…" : saveState === "error" ? "Not saved, retrying" : "All answers saved"}
        </span>
        {eventCount > 0 ? (
          <Badge tone="warning" title="Recorded integrity events">
            <AlertTriangle className="size-3" />
            {eventCount}
          </Badge>
        ) : null}
        <span
          className={cn(
            "flex items-center gap-1.5 rounded-md px-2.5 py-1 font-mono text-sm font-semibold tabular-nums",
            lowTime ? "bg-danger-soft text-danger" : "bg-muted text-foreground",
          )}
          aria-label="Time remaining"
        >
          <Clock className="size-3.5" />
          {formatCountdown(remaining)}
        </span>
        <Button variant="primary" size="sm" onClick={confirmSubmit} disabled={submitting}>
          {submitting ? <Spinner className="text-primary-foreground" /> : null}
          Submit
        </Button>
      </header>

      <div className="flex min-h-0 flex-1">
        <nav aria-label="Questions" className="w-20 shrink-0 overflow-y-auto border-r border-border p-3 sm:w-48">
          <p className="mb-2 hidden text-xs font-medium text-muted-foreground sm:block">
            {questions.length - unanswered} of {questions.length} answered
          </p>
          <ol className="grid grid-cols-1 gap-1.5 sm:grid-cols-4">
            {questions.flatMap((q, i) => [
              ...(sectionOf(q) && sectionOf(q) !== sectionOf(questions[i - 1])
                ? [
                    <li key={`section-${q.sectionId}`} className="col-span-full mt-2 hidden truncate text-xs font-semibold text-muted-foreground first:mt-0 sm:block">
                      {sectionOf(q).title}
                    </li>,
                  ]
                : []),
              <li key={q.id}>
                <button
                  type="button"
                  onClick={() => setCurrent(i)}
                  aria-current={i === current ? "step" : undefined}
                  aria-label={`Question ${i + 1}${isAnswered(q) ? ", answered" : ""}`}
                  className={cn(
                    "grid h-9 w-full place-items-center rounded-md border text-sm font-medium transition-colors",
                    i === current
                      ? "border-primary text-foreground ring-2 ring-primary/25"
                      : "border-border",
                    isAnswered(q) ? "bg-primary-soft text-primary-soft-foreground" : "bg-card text-muted-foreground hover:bg-accent",
                  )}
                >
                  {i + 1}
                </button>
              </li>,
            ])}
          </ol>
        </nav>

        <main className="min-w-0 flex-1 overflow-y-auto p-6">
          {question ? (
            <QuestionView
              key={question.id}
              index={current}
              question={question}
              section={sectionOf(question)}
              answer={answers[question.id]}
              onAnswer={(patch) => onAnswer(question.id, patch)}
              onRun={() => run(question.id)}
              running={runningId === question.id}
              disabled={submitting}
            />
          ) : null}
          <div className="mx-auto mt-8 flex max-w-3xl justify-between">
            <Button disabled={current === 0} onClick={() => setCurrent((c) => c - 1)}>
              Previous
            </Button>
            {current < questions.length - 1 ? (
              <Button onClick={() => setCurrent((c) => c + 1)}>Next</Button>
            ) : (
              <Button variant="primary" onClick={confirmSubmit} disabled={submitting}>
                Finish and submit
              </Button>
            )}
          </div>
        </main>
      </div>

      {fullscreenLost ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-background/95 p-6">
          <div className="max-w-sm text-center">
            <AlertTriangle className="mx-auto size-8 text-warning" />
            <h2 className="mt-4 text-lg font-semibold">Return to fullscreen</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              This exam must be taken in fullscreen. Leaving it has been recorded.
              Your timer is still running.
            </p>
            <Button variant="primary" className="mt-6" onClick={enterFullscreen}>
              <Maximize />
              Go back to fullscreen
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* ── Page ───────────────────────────────────────────────────────────── */

function TakeExam() {
  const { examId } = useParams();
  const router = useRouter();
  const exam = useApi(() => examApi.get(examId), [examId]);
  const [attempt, setAttempt] = useState(null);
  const [starting, setStarting] = useState(false);
  const [done, setDone] = useState(null); // null | { auto }

  const finished = exam.data?.myAttempt && exam.data.myAttempt.status !== "in_progress";
  useEffect(() => {
    if (finished) router.replace(`/exams/${examId}/result`);
  }, [finished, router, examId]);

  const onFinished = useCallback((auto) => setDone({ auto }), []);

  if (exam.loading || finished) {
    return (
      <Container size="md" className="space-y-3 py-12">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-32 w-full" />
      </Container>
    );
  }
  if (exam.error) {
    return (
      <Container size="md" className="py-16">
        <EmptyState title="Exam not available" description={exam.error.message} />
      </Container>
    );
  }
  if (done) return <Submitted exam={exam.data} auto={done.auto} />;

  const start = async () => {
    setStarting(true);
    // Fullscreen must be requested from the click itself. Don't wait for it:
    // some browsers never settle the promise, which would block the start.
    if (exam.data.proctoring.requireFullscreen) {
      document.documentElement.requestFullscreen?.().catch(() => {});
    }
    try {
      const view = await examApi.start(examId);
      if (view.status !== "in_progress") {
        router.replace(`/exams/${examId}/result`);
        return;
      }
      setAttempt(view);
    } catch (err) {
      exitFullscreen();
      toast.error(err.message);
      setStarting(false);
    }
  };

  if (!attempt) return <Intro exam={exam.data} onStart={start} starting={starting} />;
  return <Runner initial={attempt} onFinished={onFinished} />;
}

export default function TakeExamPage() {
  return (
    <RequireAuth>
      <TakeExam />
    </RequireAuth>
  );
}
