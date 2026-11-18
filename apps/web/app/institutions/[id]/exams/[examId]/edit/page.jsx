"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { AlertCircle, ChevronLeft, Code2, ListChecks, ListTodo } from "lucide-react";
import {
  Button,
  Card,
  Checkbox,
  Container,
  EmptyState,
  Field,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Spinner,
  Textarea,
} from "@logixai/ui";
import AppHeader from "@/app/components/layout/AppHeader";
import RequireAuth from "@/app/components/layout/RequireAuth";
import { examApi } from "@/app/lib/api/exams";
import { identityApi } from "@/app/lib/api/identity";
import { useApi } from "@/app/lib/api/useApi";
import { fromLocalInput, toLocalInput } from "@/app/lib/exams/format";
import QuestionEditor, { createQuestion } from "../../_components/QuestionEditor";

const VISIBILITY = {
  after_submit: "As soon as they submit",
  after_end: "After the exam closes",
  hidden: "Don't show students their score",
};

const toDraft = (exam) => ({
  title: exam.title,
  instructions: exam.instructions,
  durationMinutes: exam.durationMinutes,
  startsAt: exam.startsAt,
  endsAt: exam.endsAt,
  batchIds: exam.batchIds,
  settings: exam.settings,
  questions: exam.questions,
});

function Problems({ problems }) {
  if (!problems?.length) return null;
  return (
    <div role="alert" className="rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
      <p className="flex items-center gap-2 font-semibold">
        <AlertCircle className="size-4" />
        Fix these before publishing
      </p>
      <ul className="mt-2 list-disc space-y-0.5 pl-6">
        {problems.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
    </div>
  );
}

function Builder({ institutionId, exam, batches }) {
  const router = useRouter();
  const [draft, setDraft] = useState(() => toDraft(exam));
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(null); // "save" | "publish" | null
  const [problems, setProblems] = useState([]);

  /** Accepts a patch, or a function of the latest draft returning a patch. */
  const update = (patch) => {
    setDraft((d) => ({ ...d, ...(typeof patch === "function" ? patch(d) : patch) }));
    setDirty(true);
  };
  const setSetting = (key, value) => update((d) => ({ settings: { ...d.settings, [key]: value } }));
  const setQuestion = (index, q) =>
    update((d) => ({ questions: d.questions.map((x, i) => (i === index ? q : x)) }));
  const addQuestion = (type) => update((d) => ({ questions: [...d.questions, createQuestion(type)] }));
  const removeQuestion = (index) =>
    update((d) => ({ questions: d.questions.filter((_, j) => j !== index) }));
  const moveQuestion = (index, dir) =>
    update((d) => {
      const qs = [...d.questions];
      [qs[index], qs[index + dir]] = [qs[index + dir], qs[index]];
      return { questions: qs };
    });

  // Warn before leaving with unsaved changes.
  useEffect(() => {
    if (!dirty) return undefined;
    const onBeforeUnload = (e) => e.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const save = async () => {
    await examApi.save(exam.id, draft);
    setDirty(false);
  };

  const onSave = async () => {
    setBusy("save");
    try {
      await save();
      toast.success("Draft saved.");
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(null);
    }
  };

  const onPublish = async () => {
    setBusy("publish");
    setProblems([]);
    try {
      await save();
      await examApi.publish(exam.id);
      toast.success("Exam published. Assigned students can see it now.");
      router.push(`/institutions/${institutionId}/exams/${exam.id}/results`);
    } catch (err) {
      setProblems(err.details?.problems ?? [err.message]);
      window.scrollTo({ top: 0, behavior: "smooth" });
      setBusy(null);
    }
  };

  const onDelete = async () => {
    if (!window.confirm("Delete this draft exam? This can't be undone.")) return;
    try {
      await examApi.remove(exam.id);
      setDirty(false);
      router.push(`/institutions/${institutionId}`);
    } catch (err) {
      toast.error(err.message);
    }
  };

  const totalMarks = draft.questions.reduce((s, q) => s + (Number(q.marks) || 0), 0);

  return (
    <Container size="lg" className="space-y-6 py-8">
      <div className="flex flex-wrap items-center gap-3">
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href={`/institutions/${institutionId}`}>
            <ChevronLeft />
            Back
          </Link>
        </Button>
        <span className="text-sm text-muted-foreground">
          Draft · {draft.questions.length} questions · {totalMarks} marks
          {dirty ? " · Unsaved changes" : ""}
        </span>
        <div className="ml-auto flex gap-2">
          <Button onClick={onSave} disabled={busy !== null}>
            {busy === "save" ? <Spinner /> : null}
            Save draft
          </Button>
          <Button variant="primary" onClick={onPublish} disabled={busy !== null}>
            {busy === "publish" ? <Spinner className="text-primary-foreground" /> : null}
            Publish
          </Button>
        </div>
      </div>

      <Input
        aria-label="Exam title"
        value={draft.title}
        onChange={(e) => update({ title: e.target.value })}
        className="h-11 border-transparent bg-transparent px-0 text-2xl font-semibold focus-visible:border-transparent focus-visible:ring-0"
      />

      <Problems problems={problems} />

      <Card className="space-y-5 p-5">
        <h2 className="text-base font-semibold">Schedule and audience</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Opens" htmlFor="opens">
            <Input
              id="opens"
              type="datetime-local"
              value={toLocalInput(draft.startsAt)}
              onChange={(e) => update({ startsAt: fromLocalInput(e.target.value) })}
            />
          </Field>
          <Field label="Closes" htmlFor="closes" hint="Students must start before this.">
            <Input
              id="closes"
              type="datetime-local"
              value={toLocalInput(draft.endsAt)}
              onChange={(e) => update({ endsAt: fromLocalInput(e.target.value) })}
            />
          </Field>
          <Field label="Duration (minutes)" htmlFor="duration" hint="Time each student gets once they start.">
            <Input
              id="duration"
              type="number"
              min={1}
              max={600}
              value={draft.durationMinutes}
              onChange={(e) => update({ durationMinutes: Number(e.target.value) || 1 })}
            />
          </Field>
        </div>
        <div>
          <p className="text-sm font-medium">Batches</p>
          <p className="text-xs text-muted-foreground">
            Leave all unticked to assign every student in the institution.
          </p>
          <div className="mt-2 flex flex-wrap gap-x-6 gap-y-2">
            {batches.length === 0 ? (
              <span className="text-sm text-muted-foreground">No batches yet. Create them on the Batches tab.</span>
            ) : (
              batches.map((b) => (
                <Checkbox
                  key={b.id}
                  label={b.name}
                  description={`${b.memberCount} members`}
                  checked={draft.batchIds.includes(b.id)}
                  onChange={(e) => {
                    const on = e.target.checked;
                    update((d) => ({
                      batchIds: on ? [...d.batchIds, b.id] : d.batchIds.filter((x) => x !== b.id),
                    }));
                  }}
                />
              ))
            )}
          </div>
        </div>
        <Field label="Instructions" htmlFor="instructions" hint="Shown before students start. Markdown is supported.">
          <Textarea
            id="instructions"
            value={draft.instructions}
            onChange={(e) => update({ instructions: e.target.value })}
            placeholder="Answer all questions. Calculators are not allowed."
          />
        </Field>
      </Card>

      <Card className="space-y-4 p-5">
        <h2 className="text-base font-semibold">Integrity and results</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Checkbox
            label="Require fullscreen"
            description="Leaving fullscreen is recorded."
            checked={draft.settings.requireFullscreen}
            onChange={(e) => setSetting("requireFullscreen", e.target.checked)}
          />
          <Checkbox
            label="Block copy and paste"
            description="Attempts are blocked and recorded."
            checked={draft.settings.blockCopyPaste}
            onChange={(e) => setSetting("blockCopyPaste", e.target.checked)}
          />
          <Checkbox
            label="Shuffle question order"
            description="Each student sees a different order."
            checked={draft.settings.shuffleQuestions}
            onChange={(e) => setSetting("shuffleQuestions", e.target.checked)}
          />
          <Checkbox
            label="Shuffle answer options"
            checked={draft.settings.shuffleOptions}
            onChange={(e) => setSetting("shuffleOptions", e.target.checked)}
          />
        </div>
        <Field label="Show students their score" htmlFor="visibility">
          <Select value={draft.settings.resultsVisibility} onValueChange={(v) => setSetting("resultsVisibility", v)}>
            <SelectTrigger id="visibility" className="w-72">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(VISIBILITY).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <p className="text-xs text-muted-foreground">
          Tab switches and window changes are always recorded for you to review.
        </p>
      </Card>

      <div className="space-y-4">
        <h2 className="text-base font-semibold">Questions</h2>
        {draft.questions.length === 0 ? (
          <Card>
            <EmptyState title="Add your first question" description="Mix multiple-choice and coding questions." />
          </Card>
        ) : null}
        {draft.questions.map((q, i) => (
          <QuestionEditor
            key={q.id}
            index={i}
            total={draft.questions.length}
            question={q}
            onChange={(next) => setQuestion(i, next)}
            onRemove={() => removeQuestion(i)}
            onMove={(dir) => moveQuestion(i, dir)}
          />
        ))}
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => addQuestion("mcq_single")}>
            <ListTodo />
            Single choice
          </Button>
          <Button onClick={() => addQuestion("mcq_multi")}>
            <ListChecks />
            Multiple choice
          </Button>
          <Button onClick={() => addQuestion("coding")}>
            <Code2 />
            Coding
          </Button>
        </div>
      </div>

      <div className="border-t border-border pt-6">
        <Button variant="ghost" size="sm" className="px-0 text-danger hover:bg-transparent" onClick={onDelete}>
          Delete draft
        </Button>
      </div>
    </Container>
  );
}

function BuilderLoader() {
  const { id: institutionId, examId } = useParams();
  const exam = useApi(() => examApi.get(examId), [examId]);
  const batches = useApi(() => identityApi.listBatches(institutionId), [institutionId]);

  if (exam.loading || batches.loading) {
    return (
      <Container className="space-y-3 py-10">
        <Skeleton className="h-8 w-1/2" />
        <Skeleton className="h-40 w-full" />
      </Container>
    );
  }
  if (exam.error || !exam.data?.questions) {
    return (
      <Container className="py-16">
        <EmptyState
          icon={<AlertCircle />}
          title="You can't edit this exam"
          description={exam.error?.message ?? "Only instructors and admins can edit exams."}
        />
      </Container>
    );
  }
  if (exam.data.status !== "draft") {
    return (
      <Container className="py-16">
        <EmptyState
          title="This exam is published"
          description="Unpublish it from the results page to make changes. That's only possible before any student starts."
          action={
            <Button asChild size="sm">
              <Link href={`/institutions/${institutionId}/exams/${examId}/results`}>Go to results</Link>
            </Button>
          }
        />
      </Container>
    );
  }
  return <Builder institutionId={institutionId} exam={exam.data} batches={batches.data ?? []} />;
}

export default function EditExamPage() {
  return (
    <>
      <AppHeader />
      <RequireAuth>
        <BuilderLoader />
      </RequireAuth>
    </>
  );
}
