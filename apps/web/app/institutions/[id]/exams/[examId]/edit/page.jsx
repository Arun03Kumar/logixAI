"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { AlertCircle, AlignLeft, ChevronLeft, Code2, Library, ListChecks, ListTodo, PenLine, Plus, X } from "lucide-react";
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
import { cloneQuestion, fromLocalInput, isMcq, newId, toLocalInput } from "@/app/lib/exams/format";
import BankBrowser from "../../_components/BankBrowser";
import QuestionEditor, { createQuestion } from "../../_components/QuestionEditor";
import SaveToBankPanel from "../../_components/SaveToBankPanel";

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
  sections: exam.sections ?? [],
  questions: exam.questions,
});

/** Exam sections: titled parts (e.g. "Part A: answer any five"). Questions pick their section. */
function SectionsCard({ sections, onChange, questions }) {
  const count = (id) => questions.filter((q) => q.sectionId === id).length;
  const set = (id, patch) => onChange(sections.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  return (
    <Card className="space-y-4 p-5">
      <div>
        <h2 className="text-base font-semibold">Sections</h2>
        <p className="text-xs text-muted-foreground">
          Optional. Students see questions grouped by section, in this order; shuffling stays inside a section.
          Results show a subtotal per section.
        </p>
      </div>
      {sections.map((s, i) => (
        <div key={s.id} className="grid gap-2 rounded-lg border border-border p-3 sm:grid-cols-[1fr_2fr_auto]">
          <Input
            aria-label={`Section ${i + 1} title`}
            placeholder={`Section ${i + 1} title`}
            value={s.title}
            onChange={(e) => set(s.id, { title: e.target.value })}
          />
          <Input
            aria-label={`Section ${i + 1} instructions`}
            placeholder="Instructions (optional)"
            value={s.instructions ?? ""}
            onChange={(e) => set(s.id, { instructions: e.target.value })}
          />
          <div className="flex items-center gap-2">
            <span className="text-xs whitespace-nowrap text-muted-foreground">{count(s.id)} questions</span>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Remove section ${i + 1}`}
              onClick={() => onChange(sections.filter((x) => x.id !== s.id), s.id)}
            >
              <X />
            </Button>
          </div>
        </div>
      ))}
      {sections.length < 20 ? (
        <Button size="sm" onClick={() => onChange([...sections, { id: newId(), title: "", instructions: "" }])}>
          <Plus />
          Add section
        </Button>
      ) : null}
    </Card>
  );
}

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

function Builder({ institutionId, exam, batches, access, features }) {
  const wide = access?.scope?.all ?? true;
  const proctoring = features?.proctoring !== false;
  const subjective = features?.subjective === true;
  const [bankOpen, setBankOpen] = useState(false);
  const [banking, setBanking] = useState(null); // question id being saved to the bank
  const [negative, setNegative] = useState("");
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
  const addFromBank = (rows) => {
    update((d) => ({ questions: [...d.questions, ...rows.map((r) => cloneQuestion(r.question))] }));
    setBankOpen(false);
    toast.success(`Added ${rows.length} ${rows.length === 1 ? "question" : "questions"} from the bank.`);
  };
  /** Removing a section moves its questions out of it. */
  const setSections = (sections, removedId) =>
    update((d) => ({
      sections,
      questions: removedId ? d.questions.map((q) => (q.sectionId === removedId ? { ...q, sectionId: null } : q)) : d.questions,
    }));
  const applyNegative = () => {
    const value = Number(negative);
    if (!(value >= 0)) return;
    update((d) => ({ questions: d.questions.map((q) => (isMcq(q.type) ? { ...q, negativeMarks: value } : q)) }));
    toast.success(value ? `Every multiple-choice question now loses ${value} for a wrong answer.` : "Negative marking removed.");
  };
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
            {wide
              ? "Leave all unticked to assign every student in the institution."
              : "Pick at least one of your batches."}
          </p>
          <div className="mt-2 flex flex-wrap gap-x-6 gap-y-2">
            {batches.length === 0 ? (
              <span className="text-sm text-muted-foreground">
                {wide ? "No batches yet. Create them on the Batches tab." : "You aren't in any batch yet. Ask an admin to add you to one."}
              </span>
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
            description={proctoring ? "Leaving fullscreen is recorded." : "Proctoring isn't part of your institution's plan."}
            disabled={!proctoring}
            checked={proctoring && draft.settings.requireFullscreen}
            onChange={(e) => setSetting("requireFullscreen", e.target.checked)}
          />
          <Checkbox
            label="Block copy and paste"
            description={proctoring ? "Attempts are blocked and recorded." : "Proctoring isn't part of your institution's plan."}
            disabled={!proctoring}
            checked={proctoring && draft.settings.blockCopyPaste}
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
        <div className="grid gap-4 sm:grid-cols-2">
          <Checkbox
            label="Show rank and percentile"
            description="Students see where they stand once results are out."
            checked={draft.settings.showRank ?? false}
            onChange={(e) => setSetting("showRank", e.target.checked)}
          />
          <Field
            label="Re-evaluation requests (days)"
            htmlFor="reevaluation"
            hint="Students can ask for a question to be re-checked for this many days after the exam closes. 0 = off."
          >
            <Input
              id="reevaluation"
              type="number"
              min={0}
              max={60}
              value={draft.settings.reevaluationDays ?? 0}
              onChange={(e) => setSetting("reevaluationDays", Math.max(0, Math.min(60, Number(e.target.value) || 0)))}
              className="w-28"
            />
          </Field>
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

      <SectionsCard sections={draft.sections} onChange={setSections} questions={draft.questions} />

      <div className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <h2 className="mr-auto text-base font-semibold">Questions</h2>
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            Negative marks for every MCQ
            <Input
              type="number"
              min={0}
              step="0.25"
              value={negative}
              placeholder="e.g. 0.25"
              onChange={(e) => setNegative(e.target.value)}
              className="h-8 w-24"
            />
          </label>
          <Button size="sm" onClick={applyNegative} disabled={negative === ""}>
            Apply
          </Button>
        </div>
        {draft.questions.length === 0 ? (
          <Card>
            <EmptyState
              title="Add your first question"
              description="Mix multiple-choice, coding and written questions, or pick some from the question bank."
            />
          </Card>
        ) : null}
        {draft.questions.map((q, i) => (
          <div key={q.id} className="space-y-3">
            <QuestionEditor
              index={i}
              total={draft.questions.length}
              question={q}
              sections={draft.sections}
              subjective={subjective}
              onChange={(next) => setQuestion(i, next)}
              onRemove={() => removeQuestion(i)}
              onMove={(dir) => moveQuestion(i, dir)}
              onSaveToBank={() => setBanking(banking === q.id ? null : q.id)}
            />
            {banking === q.id ? (
              <SaveToBankPanel institutionId={institutionId} question={q} onDone={() => setBanking(null)} />
            ) : null}
          </div>
        ))}
        {bankOpen ? (
          <Card className="space-y-3 p-5">
            <div className="flex items-center">
              <h3 className="text-sm font-semibold">Add from the question bank</h3>
              <Button variant="ghost" size="icon-sm" className="ml-auto" aria-label="Close the question bank" onClick={() => setBankOpen(false)}>
                <X />
              </Button>
            </div>
            <BankBrowser institutionId={institutionId} mode="select" subjective={subjective} onAdd={addFromBank} />
          </Card>
        ) : null}
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
          <Button
            onClick={() => addQuestion("short_answer")}
            disabled={!subjective}
            title={subjective ? undefined : "Written answers aren't switched on for your institution."}
          >
            <PenLine />
            Short answer
          </Button>
          <Button
            onClick={() => addQuestion("long_answer")}
            disabled={!subjective}
            title={subjective ? undefined : "Written answers aren't switched on for your institution."}
          >
            <AlignLeft />
            Long answer
          </Button>
          <Button variant="secondary" onClick={() => setBankOpen((o) => !o)}>
            <Library />
            From question bank
          </Button>
        </div>
        {!subjective ? (
          <p className="text-xs text-muted-foreground">
            Short and long answers need the Written answers feature. Contact LogixAI to switch it on.
          </p>
        ) : null}
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
  const membership = useApi(() => identityApi.getInstitution(institutionId), [institutionId]);

  if (exam.loading || batches.loading || membership.loading) {
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
  const access = membership.data?.access;
  // Your own batches (all of them for admins); archived batches only if the exam already uses them.
  const choices = (batches.data ?? []).filter(
    (b) => exam.data.batchIds.includes(b.id) || (!b.archived && (!access || access.scope.all || access.scope.batchIds.includes(b.id))),
  );
  return (
    <Builder
      institutionId={institutionId}
      exam={exam.data}
      batches={choices}
      access={access}
      features={membership.data?.institution?.features}
    />
  );
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
