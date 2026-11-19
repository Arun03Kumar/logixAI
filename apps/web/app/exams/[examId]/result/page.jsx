"use client";
import { useEffect } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import toast from "react-hot-toast";
import { Clock, PenLine, Trophy } from "lucide-react";
import { Badge, Button, Card, Container, EmptyState, Skeleton, Spinner } from "@logixai/ui";
import AppHeader from "@/app/components/layout/AppHeader";
import RequireAuth from "@/app/components/layout/RequireAuth";
import AttemptBreakdown from "@/app/components/exams/AttemptBreakdown";
import { examApi } from "@/app/lib/api/exams";
import { useApi } from "@/app/lib/api/useApi";
import { ATTEMPT_STATUS, formatDateTime } from "@/app/lib/exams/format";

function Result() {
  const { examId } = useParams();
  const result = useApi(() => examApi.myResult(examId), [examId]);
  const exam = useApi(() => examApi.get(examId), [examId]);
  const data = result.data;
  const grading = Boolean(data?.released && data.questions.some((q) => q.awaitingGrading));
  // Coding answers still being judged (written answers wait for a person, so no polling for those).
  const judging = data?.released && data.score === null && !grading;

  // Coding answers still being judged: check again shortly.
  const { reload } = result;
  useEffect(() => {
    if (!judging) return undefined;
    const id = setTimeout(reload, 3000);
    return () => clearTimeout(id);
  }, [judging, reload, data]);

  if (result.loading && !data) {
    return (
      <Container size="md" className="space-y-3 py-10">
        <Skeleton className="h-8 w-1/2" />
        <Skeleton className="h-28 w-full" />
      </Container>
    );
  }
  if (result.error) {
    return (
      <Container size="md" className="py-16">
        <EmptyState title="No result yet" description={result.error.message} />
      </Container>
    );
  }

  const percent = data.score !== null && data.maxScore ? Math.round((data.score / data.maxScore) * 100) : null;

  const requestReevaluation = async (questionId, reason) => {
    const request = await examApi.requestReevaluation(examId, questionId, reason);
    result.setData((d) => ({
      ...d,
      questions: d.questions.map((q) => (q.questionId === questionId ? { ...q, reevaluation: request } : q)),
    }));
    toast.success("Request sent. You'll see the reply here.");
  };

  return (
    <Container size="md" className="space-y-6 py-10">
      <div>
        <h1 className="text-2xl font-semibold">{data.examTitle}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <Badge tone={ATTEMPT_STATUS[data.status].tone}>{ATTEMPT_STATUS[data.status].label}</Badge>
          {data.submittedAt ? <span>{formatDateTime(data.submittedAt)}</span> : null}
        </div>
      </div>

      <Card className="p-6">
        {!data.released ? (
          <div className="flex items-start gap-3">
            <Clock className="mt-0.5 size-5 text-muted-foreground" />
            <div>
              <p className="font-semibold">Your answers are submitted</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Your institution will release scores later. Check back after the exam closes.
              </p>
            </div>
          </div>
        ) : grading ? (
          <div className="flex items-start gap-3">
            <PenLine className="mt-0.5 size-5 text-muted-foreground" />
            <div>
              <p className="font-semibold">Your written answers are being graded</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Marks for the other questions are below. Your total appears once a teacher grades the rest.
              </p>
            </div>
          </div>
        ) : judging ? (
          <div className="flex items-center gap-3">
            <Spinner className="size-5" />
            <p className="text-sm">Your coding answers are still being judged. Your score appears here in a moment.</p>
          </div>
        ) : (
          <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
            <div>
              <p className="text-sm text-muted-foreground">Your score</p>
              <p className="text-4xl font-bold tabular-nums">
                {data.score}
                <span className="text-xl font-semibold text-muted-foreground"> / {data.maxScore}</span>
              </p>
            </div>
            <p className="pb-1 text-lg font-semibold text-muted-foreground">{percent}%</p>
            {data.rank ? (
              <div className="ml-auto flex items-center gap-3 rounded-lg bg-primary-soft px-4 py-2 text-primary-soft-foreground">
                <Trophy className="size-5" />
                <div>
                  <p className="text-sm font-semibold">
                    Rank {data.rank.position} of {data.rank.outOf}
                  </p>
                  <p className="text-xs">Better than {data.rank.percentile}% of others</p>
                </div>
              </div>
            ) : null}
          </div>
        )}
        {data.released && data.reevaluation?.open ? (
          <p className="mt-4 border-t border-border pt-3 text-xs text-muted-foreground">
            Think a question was marked wrongly? You can ask for a re-check until {formatDateTime(data.reevaluation.until)}.
          </p>
        ) : null}
      </Card>

      {data.released ? <AttemptBreakdown result={data} onRequest={requestReevaluation} /> : null}

      {exam.data ? (
        <Button asChild>
          <Link href={`/institutions/${exam.data.institutionId}`}>Back to institution</Link>
        </Button>
      ) : null}
    </Container>
  );
}

export default function ResultPage() {
  return (
    <>
      <AppHeader />
      <RequireAuth>
        <Result />
      </RequireAuth>
    </>
  );
}
