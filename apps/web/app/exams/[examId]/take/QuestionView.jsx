"use client";
import dynamic from "next/dynamic";
import { CheckCircle2, Play, XCircle } from "lucide-react";
import {
  Badge,
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
  cn,
} from "@logixai/ui";
import { LANGUAGES } from "@logixai/languages";
import Markdown from "@/app/coding-platform/components/Markdown";
import {
  editorOptions,
  handleEditorMount,
} from "@/app/coding-platform/components/problem/editorConfig";
import { QUESTION_TYPE } from "@/app/lib/exams/format";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
  loading: () => (
    <div className="grid h-full place-items-center bg-[#1e1e1e]">
      <Spinner />
    </div>
  ),
});

function McqAnswer({ question, answer, onAnswer, disabled }) {
  const single = question.type === "mcq_single";
  const selected = answer?.selectedOptionIds ?? [];
  const toggle = (id) => {
    if (single) return onAnswer({ selectedOptionIds: [id] });
    onAnswer({
      selectedOptionIds: selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id],
    });
  };
  return (
    <fieldset className="space-y-2" disabled={disabled}>
      <legend className="mb-2 text-sm text-muted-foreground">
        {single ? "Choose one answer." : "Choose all that apply."}
      </legend>
      {question.options.map((option, i) => {
        const checked = selected.includes(option.id);
        return (
          <label
            key={option.id}
            className={cn(
              "flex cursor-pointer items-start gap-3 rounded-lg border px-4 py-3 text-sm transition-colors",
              checked ? "border-primary bg-primary-soft" : "border-border bg-card hover:bg-accent",
            )}
          >
            <input
              type={single ? "radio" : "checkbox"}
              name={`q-${question.id}`}
              checked={checked}
              onChange={() => toggle(option.id)}
              className="mt-0.5 size-4 shrink-0 accent-primary"
            />
            <span>
              <span className="mr-2 font-semibold text-muted-foreground">{String.fromCharCode(65 + i)}.</span>
              {option.text}
            </span>
          </label>
        );
      })}
      {selected.length > 0 && single ? (
        <button
          type="button"
          className="text-xs font-medium text-muted-foreground hover:text-foreground"
          onClick={() => onAnswer({ selectedOptionIds: [] })}
        >
          Clear answer
        </button>
      ) : null}
    </fieldset>
  );
}

function JudgeLine({ judge, running }) {
  if (running || judge?.status === "pending") {
    return (
      <span className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner className="size-3.5" />
        Running your code against the tests…
      </span>
    );
  }
  if (!judge) {
    return <span className="text-sm text-muted-foreground">Run your code to check it against the tests.</span>;
  }
  const all = judge.passed === judge.total;
  return (
    <span className={cn("flex items-center gap-2 text-sm font-medium", all ? "text-success" : "text-danger")}>
      {all ? <CheckCircle2 className="size-4" /> : <XCircle className="size-4" />}
      {judge.passed} of {judge.total} tests passed
    </span>
  );
}

function CodingAnswer({ question, answer, onAnswer, onRun, running, disabled }) {
  const language = answer?.language ?? question.languages[0];
  const code = answer?.code ?? question.starterCode?.[language] ?? "";
  return (
    <div className="flex h-full min-h-[480px] flex-col overflow-hidden rounded-lg border border-border">
      <div className="flex items-center gap-2 border-b border-border bg-card px-3 py-2">
        <Select
          value={language}
          disabled={disabled}
          onValueChange={(next) =>
            onAnswer({ language: next, code: answer?.code ?? question.starterCode?.[next] ?? "" })
          }
        >
          <SelectTrigger size="sm" className="w-32" aria-label="Language">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {question.languages.map((id) => (
              <SelectItem key={id} value={id}>
                {LANGUAGES[id].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="ml-auto">
          <Button size="sm" onClick={onRun} disabled={disabled || running || answer?.judge?.status === "pending"}>
            <Play />
            Run tests
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 bg-[#1e1e1e]">
        <MonacoEditor
          height="100%"
          path={`exam-${question.id}-${language}`}
          language={LANGUAGES[language]?.monacoId ?? "plaintext"}
          theme="vs-dark"
          value={code}
          onChange={(value) => onAnswer({ language, code: value ?? "" })}
          onMount={handleEditorMount}
          options={editorOptions({ readOnly: disabled, contextmenu: false })}
        />
      </div>
      <div className="border-t border-border bg-card px-3 py-2.5">
        <JudgeLine judge={answer?.judge} running={running} />
        {answer?.judge?.message ? (
          <pre className="mt-2 max-h-28 overflow-auto rounded-md bg-muted px-3 py-2 font-mono text-xs text-danger whitespace-pre-wrap">
            {answer.judge.message}
          </pre>
        ) : null}
      </div>
    </div>
  );
}

export default function QuestionView({ index, question, answer, onAnswer, onRun, running, disabled }) {
  const header = (
    <div className="flex flex-wrap items-center gap-2">
      <h2 className="text-lg font-semibold">Question {index + 1}</h2>
      <Badge>{QUESTION_TYPE[question.type]}</Badge>
      <Badge tone="outline">
        {question.marks} {question.marks === 1 ? "mark" : "marks"}
      </Badge>
    </div>
  );

  if (question.type !== "coding") {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        {header}
        <Markdown>{question.prompt}</Markdown>
        <McqAnswer question={question} answer={answer} onAnswer={onAnswer} disabled={disabled} />
      </div>
    );
  }

  return (
    <div className="grid h-full gap-6 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
      <div className="space-y-5 overflow-y-auto">
        {header}
        <Markdown>{question.prompt}</Markdown>
        {question.sampleTestCases?.length ? (
          <div className="space-y-2">
            <p className="text-sm font-semibold">Examples</p>
            {question.sampleTestCases.map((tc, i) => (
              <div key={i} className="grid gap-2 sm:grid-cols-2">
                <div>
                  <p className="text-xs text-muted-foreground">Input</p>
                  <pre className="mt-1 rounded-md border border-border bg-muted px-3 py-2 font-mono text-xs whitespace-pre-wrap">
                    {tc.input}
                  </pre>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Expected output</p>
                  <pre className="mt-1 rounded-md border border-border bg-muted px-3 py-2 font-mono text-xs whitespace-pre-wrap">
                    {tc.output}
                  </pre>
                </div>
              </div>
            ))}
            <p className="text-xs text-muted-foreground">
              Your answer is also scored against hidden tests.
            </p>
          </div>
        ) : null}
      </div>
      <CodingAnswer
        question={question}
        answer={answer}
        onAnswer={onAnswer}
        onRun={onRun}
        running={running}
        disabled={disabled}
      />
    </div>
  );
}
