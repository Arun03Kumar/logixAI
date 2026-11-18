"use client";
import { useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2, X } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  Checkbox,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tabs,
  Textarea,
} from "@logixai/ui";
import { LANGUAGES, listLanguages } from "@logixai/languages";
import { QUESTION_TYPE, newId } from "@/app/lib/exams/format";
import TestCaseList from "./TestCaseList";

export function createQuestion(type) {
  if (type === "coding") {
    return {
      id: newId(),
      type,
      prompt: "",
      marks: 10,
      languages: ["PYTHON"],
      codeStubs: [{ language: "PYTHON", startSnippet: "", userSnippet: "", endSnippet: "" }],
      sampleTestCases: [{ input: "", output: "" }],
      hiddenTestCases: [{ input: "", output: "" }],
    };
  }
  return {
    id: newId(),
    type,
    prompt: "",
    marks: 1,
    options: [
      { id: newId(), text: "" },
      { id: newId(), text: "" },
    ],
    correctOptionIds: [],
  };
}

function McqFields({ question, onChange }) {
  const single = question.type === "mcq_single";
  const setOption = (id, text) =>
    onChange({ ...question, options: question.options.map((o) => (o.id === id ? { ...o, text } : o)) });
  const toggleCorrect = (id) => {
    const isCorrect = question.correctOptionIds.includes(id);
    const correctOptionIds = single
      ? [id]
      : isCorrect
        ? question.correctOptionIds.filter((c) => c !== id)
        : [...question.correctOptionIds, id];
    onChange({ ...question, correctOptionIds });
  };
  const removeOption = (id) =>
    onChange({
      ...question,
      options: question.options.filter((o) => o.id !== id),
      correctOptionIds: question.correctOptionIds.filter((c) => c !== id),
    });

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">Options</p>
      <p className="text-xs text-muted-foreground">
        Tick the correct {single ? "answer" : "answers. Students must pick all of them to get the marks"}.
      </p>
      {question.options.map((option, i) => (
        <div key={option.id} className="flex items-center gap-2">
          <input
            type={single ? "radio" : "checkbox"}
            name={`correct-${question.id}`}
            aria-label={`Option ${i + 1} is correct`}
            checked={question.correctOptionIds.includes(option.id)}
            onChange={() => toggleCorrect(option.id)}
            className="size-4 shrink-0 accent-primary"
          />
          <Input
            aria-label={`Option ${i + 1}`}
            placeholder={`Option ${i + 1}`}
            value={option.text}
            onChange={(e) => setOption(option.id, e.target.value)}
          />
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Remove option ${i + 1}`}
            disabled={question.options.length <= 2}
            onClick={() => removeOption(option.id)}
          >
            <X />
          </Button>
        </div>
      ))}
      {question.options.length < 10 ? (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onChange({ ...question, options: [...question.options, { id: newId(), text: "" }] })}
        >
          <Plus />
          Add option
        </Button>
      ) : null}
    </div>
  );
}

function CodingFields({ question, onChange }) {
  const [activeLang, setActiveLang] = useState(question.languages[0] ?? "PYTHON");
  const lang = question.languages.includes(activeLang) ? activeLang : question.languages[0];
  const stub = question.codeStubs.find((s) => s.language === lang) ?? {
    language: lang,
    startSnippet: "",
    userSnippet: "",
    endSnippet: "",
  };

  const toggleLanguage = (id) => {
    const enabled = question.languages.includes(id);
    const languages = enabled ? question.languages.filter((l) => l !== id) : [...question.languages, id];
    const codeStubs = enabled
      ? question.codeStubs.filter((s) => s.language !== id)
      : [...question.codeStubs, { language: id, startSnippet: "", userSnippet: "", endSnippet: "" }];
    onChange({ ...question, languages, codeStubs });
    if (!enabled) setActiveLang(id);
  };

  const setStub = (field, value) =>
    onChange({
      ...question,
      codeStubs: [
        ...question.codeStubs.filter((s) => s.language !== lang),
        { ...stub, [field]: value },
      ],
    });

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm font-medium">Allowed languages</p>
        <div className="mt-2 flex flex-wrap gap-4">
          {listLanguages().map((l) => (
            <Checkbox
              key={l.id}
              label={l.label}
              checked={question.languages.includes(l.id)}
              onChange={() => toggleLanguage(l.id)}
            />
          ))}
        </div>
      </div>

      {lang ? (
        <div className="space-y-3">
          <Tabs
            size="sm"
            aria-label="Code stub language"
            items={question.languages.map((id) => ({ value: id, label: LANGUAGES[id].label }))}
            value={lang}
            onValueChange={setActiveLang}
          />
          <p className="text-xs text-muted-foreground">
            The judge runs: code before + the student&apos;s code + code after.
          </p>
          {[
            ["startSnippet", "Code before the student's code", "Hidden. Imports, helpers, class header."],
            ["userSnippet", "Starter code", "Shown in the student's editor."],
            ["endSnippet", "Code after the student's code", "Hidden. Reads input, calls the solution, prints the result."],
          ].map(([field, label, hint]) => (
            <div key={field} className="space-y-1">
              <p className="text-sm font-medium">{label}</p>
              <p className="text-xs text-muted-foreground">{hint}</p>
              <Textarea
                value={stub[field] ?? ""}
                onChange={(e) => setStub(field, e.target.value)}
                spellCheck={false}
                className="min-h-24 font-mono text-[13px]"
              />
            </div>
          ))}
        </div>
      ) : null}

      <TestCaseList
        label="Sample tests"
        hint="Shown to students. Up to 5."
        cases={question.sampleTestCases}
        onChange={(sampleTestCases) => onChange({ ...question, sampleTestCases })}
        max={5}
      />
      <TestCaseList
        label="Hidden tests"
        hint="Never shown. Marks are split across sample and hidden tests that pass."
        cases={question.hiddenTestCases}
        onChange={(hiddenTestCases) => onChange({ ...question, hiddenTestCases })}
        max={50}
      />
    </div>
  );
}

export default function QuestionEditor({ index, total, question, onChange, onRemove, onMove }) {
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-3">
        <p className="text-sm font-semibold">Question {index + 1}</p>
        {question.type === "coding" ? (
          <Badge tone="brand">Coding</Badge>
        ) : (
          <Select
            value={question.type}
            onValueChange={(type) =>
              onChange({
                ...question,
                type,
                correctOptionIds: type === "mcq_single" ? question.correctOptionIds.slice(0, 1) : question.correctOptionIds,
              })
            }
          >
            <SelectTrigger size="sm" className="w-40" aria-label="Question type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="mcq_single">{QUESTION_TYPE.mcq_single}</SelectItem>
              <SelectItem value="mcq_multi">{QUESTION_TYPE.mcq_multi}</SelectItem>
            </SelectContent>
          </Select>
        )}
        <label className="ml-auto flex items-center gap-2 text-sm text-muted-foreground">
          Marks
          <Input
            type="number"
            min={0}
            step="0.5"
            value={question.marks}
            onChange={(e) => onChange({ ...question, marks: Number(e.target.value) })}
            className="h-8 w-20"
          />
        </label>
        <div className="flex">
          <Button variant="ghost" size="icon-sm" aria-label="Move up" disabled={index === 0} onClick={() => onMove(-1)}>
            <ArrowUp />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Move down"
            disabled={index === total - 1}
            onClick={() => onMove(1)}
          >
            <ArrowDown />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="Delete question" onClick={onRemove}>
            <Trash2 />
          </Button>
        </div>
      </div>
      <div className="space-y-5 p-5">
        <div className="space-y-1">
          <p className="text-sm font-medium">Question</p>
          <p className="text-xs text-muted-foreground">Markdown is supported.</p>
          <Textarea
            value={question.prompt}
            onChange={(e) => onChange({ ...question, prompt: e.target.value })}
            placeholder={question.type === "coding" ? "Given an integer n, print n squared." : "Which data structure is FIFO?"}
            className="min-h-24"
          />
        </div>
        {question.type === "coding" ? (
          <CodingFields question={question} onChange={onChange} />
        ) : (
          <McqFields question={question} onChange={onChange} />
        )}
      </div>
    </Card>
  );
}
