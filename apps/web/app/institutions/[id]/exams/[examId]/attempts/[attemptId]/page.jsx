"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AlertTriangle, ChevronLeft } from "lucide-react";
import { Badge, Button, Card, Container, EmptyState, Skeleton } from "@logixai/ui";
import AppHeader from "@/app/components/layout/AppHeader";
import RequireAuth from "@/app/components/layout/RequireAuth";
import AttemptBreakdown from "@/app/components/exams/AttemptBreakdown";
import { examApi } from "@/app/lib/api/exams";
import { useApi } from "@/app/lib/api/useApi";
import {
  ATTEMPT_STATUS,
  PROCTOR_EVENT,
  formatDateTime,
  formatScore,
} from "@/app/lib/exams/format";

function Review() {
  const { id: institutionId, examId, attemptId } = useParams();
  const review = useApi(() => examApi.review(examId, attemptId), [examId, attemptId]);

  if (review.loading) {
    return (
      <Container size="md" className="space-y-3 py-10">
        <Skeleton className="h-8 w-1/2" />
        <Skeleton className="h-40 w-full" />
      </Container>
    );
  }
  if (review.error) {
    return (
      <Container size="md" className="py-16">
        <EmptyState title="Attempt not available" description={review.error.message} />
      </Container>
    );
  }

  const r = review.data;
  return (
    <Container size="md" className="space-y-6 py-10">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href={`/institutions/${institutionId}/exams/${examId}/results`}>
          <ChevronLeft />
          All results
        </Link>
      </Button>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{r.student.name}</h1>
          <p className="text-sm text-muted-foreground">
            {r.student.email} · {r.examTitle}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <Badge tone={ATTEMPT_STATUS[r.status].tone}>{ATTEMPT_STATUS[r.status].label}</Badge>
            <span>Started {formatDateTime(r.startedAt)}</span>
            {r.submittedAt ? <span>· Submitted {formatDateTime(r.submittedAt)}</span> : null}
          </div>
        </div>
        <div className="text-right">
          <p className="text-sm text-muted-foreground">Score</p>
          <p className="text-3xl font-bold tabular-nums">{formatScore(r.score, r.maxScore)}</p>
        </div>
      </div>

      <Card className="p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          {r.proctorEvents.length ? <AlertTriangle className="size-4 text-warning" /> : null}
          Integrity events ({r.proctorEvents.length})
        </h2>
        {r.proctorEvents.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">Nothing was recorded during this attempt.</p>
        ) : (
          <ol className="mt-3 space-y-1.5 text-sm">
            {r.proctorEvents.map((e, i) => (
              <li key={i} className="flex gap-3">
                <span className="w-28 shrink-0 tabular-nums text-muted-foreground">{formatDateTime(e.at)}</span>
                <span>{PROCTOR_EVENT[e.type] ?? e.type}</span>
              </li>
            ))}
          </ol>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          These are signals, not proof. A tab switch can be a notification or an accidental click.
        </p>
      </Card>

      <AttemptBreakdown result={r} />
    </Container>
  );
}

export default function AttemptReviewPage() {
  return (
    <>
      <AppHeader />
      <RequireAuth>
        <Review />
      </RequireAuth>
    </>
  );
}
