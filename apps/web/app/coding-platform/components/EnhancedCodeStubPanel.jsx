"use client";

import React, { useCallback, useEffect, useRef, memo } from "react";
import dynamic from "next/dynamic";
import {
  Badge,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
} from "@logixai/ui";
import { LANGUAGES, listLanguages } from "@logixai/languages";
import {
  editorOptions,
  handleEditorMount,
} from "@/app/coding-platform/components/problem/editorConfig";

// Monaco is uncontrolled here to avoid re-mount flashes on every keypress.
const MonacoEditor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
  loading: () => (
    <div className="grid h-full place-items-center bg-[#1e1e1e]">
      <Spinner />
    </div>
  ),
});

const DEBOUNCE_MS = 500;
const EMPTY = { startSnippet: "", userSnippet: "", endSnippet: "" };

/**
 * The judge runs: startSnippet + student's code + endSnippet.
 * Listed in that order so authors see how the final program is assembled.
 */
const SLOTS = [
  {
    key: "startSnippet",
    title: "Code before the solution",
    hint: "Hidden from students. Imports, helpers, class header.",
  },
  {
    key: "userSnippet",
    title: "Starter code",
    hint: "Shown in the student's editor. They complete or replace it.",
  },
  {
    key: "endSnippet",
    title: "Code after the solution",
    hint: "Hidden. Driver that reads input, calls the solution and prints the result.",
  },
];

const hasContent = (stub) =>
  Boolean(stub) && SLOTS.some(({ key }) => stub[key]?.trim());

function EnhancedCodeStubPanelComponent({
  codeStubs,
  currentLanguage,
  onLanguageChange,
  onCodeStubUpdate,
}) {
  const currentStub = codeStubs[currentLanguage] || EMPTY;

  // Live editor contents for the current language, pushed to the store on a debounce.
  const valuesRef = useRef({ ...EMPTY, ...currentStub });
  const timerRef = useRef(null);
  const latest = useRef({ currentLanguage, onCodeStubUpdate });
  useEffect(() => {
    latest.current = { currentLanguage, onCodeStubUpdate };
  });

  const flush = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const { currentLanguage: lang, onCodeStubUpdate: update } = latest.current;
    update(lang, { ...valuesRef.current });
  }, []);

  const schedule = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(flush, DEBOUNCE_MS);
  }, [flush]);

  // Save pending edits when leaving the tab instead of dropping them.
  useEffect(
    () => () => {
      if (timerRef.current) flush();
    },
    [flush],
  );

  const changeLanguage = (next) => {
    flush();
    valuesRef.current = { ...EMPTY, ...(codeStubs[next] || {}) };
    onLanguageChange(next);
  };

  const monacoLanguage = LANGUAGES[currentLanguage]?.monacoId || "plaintext";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold">Code stubs</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            The judge runs the code before the solution, then the student&apos;s
            code, then the code after it. Set this up for each language you want
            to allow. Changes save automatically.
          </p>
        </div>
        <Select value={currentLanguage} onValueChange={changeLanguage}>
          <SelectTrigger className="w-40" aria-label="Language">
            <SelectValue placeholder="Language" />
          </SelectTrigger>
          <SelectContent>
            {listLanguages().map((lang) => (
              <SelectItem key={lang.id} value={lang.id}>
                {lang.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        {SLOTS.map(({ key, title, hint }) => (
          <section key={key} className="flex min-w-0 flex-col gap-2">
            <div>
              <h3 className="text-sm font-semibold">{title}</h3>
              <p className="text-xs text-muted-foreground">{hint}</p>
            </div>
            <div className="h-[48vh] overflow-hidden rounded-lg border border-border bg-[#1e1e1e]">
              <MonacoEditor
                key={`${key}-${currentLanguage}`}
                path={`${key}-${currentLanguage}`}
                language={monacoLanguage}
                theme="vs-dark"
                defaultValue={currentStub[key] || ""}
                onMount={(editor, monaco) => {
                  handleEditorMount(editor, monaco);
                  editor.onDidChangeModelContent(() => {
                    valuesRef.current[key] = editor.getValue();
                    schedule();
                  });
                }}
                options={editorOptions()}
              />
            </div>
          </section>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
        <span className="text-xs text-muted-foreground">Languages set up:</span>
        {listLanguages().map((lang) => (
          <Badge
            key={lang.id}
            tone={hasContent(codeStubs[lang.id]) ? "success" : "outline"}
          >
            {lang.label}
          </Badge>
        ))}
      </div>
    </div>
  );
}

export default memo(EnhancedCodeStubPanelComponent);
