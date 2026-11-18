"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { ClipboardList, Plus } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  Skeleton,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@logixai/ui";
import { examApi } from "@/app/lib/api/exams";
import { useApi } from "@/app/lib/api/useApi";
import { ATTEMPT_STATUS, PHASE, formatScore, formatWindow } from "@/app/lib/exams/format";
import { canView } from "../../labels";

function CreateExam({ institutionId }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);

  const create = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const exam = await examApi.create(institutionId, title);
      router.push(`/institutions/${institutionId}/exams/${exam.id}/edit`);
    } catch (err) {
      toast.error(err.fieldErrors?.title ?? err.message);
      setSaving(false);
    }
  };

  return (
    <Card className="p-5">
      <h2 className="text-sm font-semibold">Create an exam</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Add questions, choose batches and a time window, then publish it to
        your students.
      </p>
      <form onSubmit={create} className="mt-4 flex max-w-lg gap-2">
        <Input
          aria-label="Exam title"
          placeholder="Data structures mid-term"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <Button type="submit" variant="primary" disabled={saving || !title.trim()}>
          {saving ? <Spinner className="text-primary-foreground" /> : <Plus />}
          Create
        </Button>
      </form>
    </Card>
  );
}

function StaffExams({ institutionId, exams }) {
  if (exams.length === 0) {
    return (
      <EmptyState
        icon={<ClipboardList />}
        title="No exams yet"
        description="Exams you create appear here with their schedule and results."
      />
    );
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Exam</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Window</TableHead>
          <TableHead>Questions</TableHead>
          <TableHead className="w-28">
            <span className="sr-only">Actions</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {exams.map((exam) => (
          <TableRow key={exam.id}>
            <TableCell>
              <p className="font-medium">{exam.title}</p>
              <p className="text-xs text-muted-foreground">
                {exam.durationMinutes} min · {exam.totalMarks} marks
              </p>
            </TableCell>
            <TableCell>
              <Badge tone={PHASE[exam.phase].tone}>{PHASE[exam.phase].label}</Badge>
            </TableCell>
            <TableCell className="whitespace-nowrap text-muted-foreground">
              {formatWindow(exam.startsAt, exam.endsAt)}
            </TableCell>
            <TableCell className="text-muted-foreground">{exam.questionCount}</TableCell>
            <TableCell className="text-right">
              <Button asChild size="sm" variant="ghost">
                <Link
                  href={
                    exam.status === "draft"
                      ? `/institutions/${institutionId}/exams/${exam.id}/edit`
                      : `/institutions/${institutionId}/exams/${exam.id}/results`
                  }
                >
                  {exam.status === "draft" ? "Edit" : "Results"}
                </Link>
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function StudentAction({ exam }) {
  const attempt = exam.myAttempt;
  if (attempt && attempt.status !== "in_progress") {
    return (
      <Button asChild size="sm">
        <Link href={`/exams/${exam.id}/result`}>View result</Link>
      </Button>
    );
  }
  if (exam.phase === "live") {
    return (
      <Button asChild size="sm" variant="primary">
        <Link href={`/exams/${exam.id}/take`}>{attempt ? "Resume" : "Start"}</Link>
      </Button>
    );
  }
  return (
    <span className="text-sm text-muted-foreground">
      {exam.phase === "upcoming" ? "Not open yet" : "Missed"}
    </span>
  );
}

function StudentExams({ exams }) {
  if (exams.length === 0) {
    return (
      <EmptyState
        icon={<ClipboardList />}
        title="No exams assigned to you"
        description="When your institution schedules an exam for your batch, it appears here."
      />
    );
  }
  return (
    <ul className="divide-y divide-border">
      {exams.map((exam) => (
        <li key={exam.id} className="flex flex-wrap items-center gap-4 px-5 py-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="font-medium">{exam.title}</p>
              <Badge tone={PHASE[exam.phase].tone}>{PHASE[exam.phase].label}</Badge>
              {exam.myAttempt ? (
                <Badge tone={ATTEMPT_STATUS[exam.myAttempt.status].tone}>
                  {ATTEMPT_STATUS[exam.myAttempt.status].label}
                </Badge>
              ) : null}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {formatWindow(exam.startsAt, exam.endsAt)} · {exam.durationMinutes} min ·{" "}
              {exam.myAttempt && exam.myAttempt.score !== null
                ? `Score ${formatScore(exam.myAttempt.score, exam.myAttempt.maxScore)}`
                : `${exam.totalMarks} marks`}
            </p>
          </div>
          <StudentAction exam={exam} />
        </li>
      ))}
    </ul>
  );
}

export default function ExamsTab({ institutionId, myRole }) {
  const exams = useApi(() => examApi.list(institutionId), [institutionId]);
  const staff = canView(myRole);

  return (
    <div className="space-y-4">
      {staff ? <CreateExam institutionId={institutionId} /> : null}
      <Card className="overflow-hidden">
        {exams.loading ? (
          <div className="space-y-3 p-5">
            <Skeleton className="h-5 w-1/2" />
            <Skeleton className="h-5 w-1/3" />
          </div>
        ) : exams.error ? (
          <EmptyState title="Couldn't load exams" description={exams.error.message} />
        ) : staff ? (
          <StaffExams institutionId={institutionId} exams={exams.data} />
        ) : (
          <StudentExams exams={exams.data} />
        )}
      </Card>
    </div>
  );
}
