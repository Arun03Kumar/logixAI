"use client";
import React from "react";
import { useSelector, useDispatch } from "react-redux";
import dynamic from "next/dynamic";
import { Spinner } from "@logixai/ui";
import { setUserCode } from "@/app/coding-platform/store/problemSlice";
import { findLanguage } from "@logixai/languages";
import { editorOptions, handleEditorMount } from "./editorConfig";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
  loading: () => (
    <div className="grid h-full place-items-center bg-[#1e1e1e]">
      <Spinner />
    </div>
  ),
});

export default function CodeEditor() {
  const dispatch = useDispatch();
  const language = useSelector((state) => state.problem.language);
  const userCode = useSelector((state) => state.problem.userCode);

  return (
    <div className="min-h-0 flex-1 bg-[#1e1e1e]">
      <MonacoEditor
        height="100%"
        language={findLanguage(language || "")?.monacoId || "plaintext"}
        theme="vs-dark"
        value={userCode}
        onChange={(value) => dispatch(setUserCode(value || ""))}
        onMount={handleEditorMount}
        options={editorOptions()}
      />
    </div>
  );
}
