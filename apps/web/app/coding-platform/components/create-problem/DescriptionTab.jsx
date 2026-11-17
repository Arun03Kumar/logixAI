"use client";
import React from "react";
import { useSelector, useDispatch } from "react-redux";
import dynamic from "next/dynamic";
import { Skeleton } from "@logixai/ui";
import { setDescription } from "@/app/coding-platform/store/createProblemSlice";
import Markdown from "@/app/coding-platform/components/Markdown";
import EditorPreviewLayout from "./EditorPreviewLayout";

const BlockNoteEditor = dynamic(
  () => import("@/app/coding-platform/components/BlockNoteEditor"),
  { ssr: false, loading: () => <Skeleton className="h-full w-full" /> },
);

export default function DescriptionTab() {
  const dispatch = useDispatch();
  const description = useSelector((state) => state.createProblem.description);
  const safeMarkdown = typeof description === "string" ? description : "";

  return (
    <EditorPreviewLayout
      editorLabel="Statement"
      editor={
        <BlockNoteEditor
          onMarkdownChange={(markdown) => dispatch(setDescription(markdown))}
        />
      }
      preview={
        safeMarkdown.trim() ? (
          <Markdown>{safeMarkdown}</Markdown>
        ) : (
          <p className="text-sm text-muted-foreground">
            The statement as students will see it appears here.
          </p>
        )
      }
    />
  );
}
