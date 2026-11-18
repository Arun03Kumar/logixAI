"use client";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { AlertTriangle, ChevronLeft, Download, Users } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  Container,
  EmptyState,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@logixai/ui";
import AppHeader from "@/app/components/layout/AppHeader";
import RequireAuth from "@/app/components/layout/RequireAuth";
import { examApi } from "@/app/lib/api/exams";
import { useApi } from "@/app/lib/api/useApi";
import {
  ATTEMPT_STATUS,
  PHASE,
  formatDateTime,
  formatScore,
  formatWindow,
} from "@/app/lib/exams/format";

function Stat({ label, value }) {
  return (
    <div className="rounded-lg bg-muted px-4 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}

/** CSV of the results table, opened in Excel / Google Sheets. */
function downloadCsv(exam, rows) {
  const escape = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const header = ["Name", "Email", "Status", "Score", "Max score", "Started", "Submitted", "Integrity events"];
  const lines = rows.map((r) =>
    [r.name, r.email, ATTEMPT_STATUS[r.status].label, r.score ?? "", r.maxScore, r.startedAt, r.submittedAt ?? "", r.proctorEventCount]
      .map(escape)
      .join(","),
  );
  const blob = new Blob([[header.map(escape).join(","), ...lines].join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), {
    href: url,
    download: `${exam.title.replace(/[^\w-]+/g, "-")}-results.csv`,
  });
  a.click();
  URL.revokeObjectURL(url);
}

function Results() {
  const { id: institutionId, examId } = useParams();
  const router = useRouter();
  const results = useApi(() => examApi.results(examId), [examId]);

  if (results.loading) {
    return (
      <Container className="space-y-3 py-10">
        <Skeleton className="h-8 w-1/2" />
        <Skeleton className="h-40 w-full" />
      </Container>
    );
  }
  if (results.error) {
    return (
      <Container className="py-16">
        <EmptyState title="Results not available" description={results.error.message} />
      </Container>
    );
  }

  const { exam, rows } = results.data;
  const scored = rows.filter((r) => r.score !== null);
  const average = scored.length ? (scored.reduce((s, r) => s + r.score, 0) / scored.length).toFixed(1) : "—";
  const highest = scored.length ? Math.max(...scored.map((r) => r.score)) : "—";
  const flagged = rows.filter((r) => r.proctorEventCount > 0).length;

  const unpublish = async () => {
    if (!window.confirm("Unpublish this exam? Students won't see it until you publish it again.")) return;
    try {
      await examApi.unpublish(examId);
      router.push(`/institutions/${institutionId}/exams/${examId}/edit`);
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <Container className="space-y-6 py-10">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href={`/institutions/${institutionId}`}>
          <ChevronLeft />
          Back
        </Link>
      </Button>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold">{exam.title}</h1>
            <Badge tone={PHASE[exam.phase].tone}>{PHASE[exam.phase].label}</Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {formatWindow(exam.startsAt, exam.endsAt)} · {exam.durationMinutes} min · {exam.totalMarks} marks
          </p>
        </div>
        <div className="flex gap-2">
          {rows.length === 0 && exam.phase !== "ended" ? <Button onClick={unpublish}>Unpublish to edit</Button> : null}
          <Button onClick={() => downloadCsv(exam, rows)} disabled={rows.length === 0}>
            <Download />
            Export CSV
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Attempts" value={rows.length} />
        <Stat label="Average score" value={average} />
        <Stat label="Highest score" value={highest} />
        <Stat label="With integrity events" value={flagged} />
      </div>

      <Card className="overflow-hidden">
        {rows.length === 0 ? (
          <EmptyState
            icon={<Users />}
            title="No attempts yet"
            description={
              exam.phase === "upcoming"
                ? "Students can start when the exam opens."
                : "Attempts appear here as students start the exam."
            }
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Student</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Score</TableHead>
                <TableHead>Submitted</TableHead>
                <TableHead>Integrity</TableHead>
                <TableHead className="w-20">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.attemptId}>
                  <TableCell>
                    <p className="font-medium">{r.name}</p>
                    <p className="text-xs text-muted-foreground">{r.email}</p>
                  </TableCell>
                  <TableCell>
                    <Badge tone={ATTEMPT_STATUS[r.status].tone}>{ATTEMPT_STATUS[r.status].label}</Badge>
                  </TableCell>
                  <TableCell className="font-medium tabular-nums">{formatScore(r.score, r.maxScore)}</TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">{formatDateTime(r.submittedAt)}</TableCell>
                  <TableCell>
                    {r.proctorEventCount > 0 ? (
                      <Badge tone="warning">
                        <AlertTriangle className="size-3" />
                        {r.proctorEventCount}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button asChild size="sm" variant="ghost">
                      <Link href={`/institutions/${institutionId}/exams/${examId}/attempts/${r.attemptId}`}>Review</Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </Container>
  );
}

export default function ExamResultsPage() {
  return (
    <>
      <AppHeader />
      <RequireAuth>
        <Results />
      </RequireAuth>
    </>
  );
}
