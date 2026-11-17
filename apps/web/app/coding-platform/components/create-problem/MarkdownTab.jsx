"use client";
import React from "react";
import { useSelector, useDispatch } from "react-redux";
import { Textarea } from "@logixai/ui";
import { setMarkdownText } from "@/app/coding-platform/store/createProblemSlice";
import Markdown from "@/app/coding-platform/components/Markdown";
import EditorPreviewLayout from "./EditorPreviewLayout";

export default function MarkdownTab() {
  const dispatch = useDispatch();
  const markdownText = useSelector((state) => state.createProblem.markdownText);

  return (
    <EditorPreviewLayout
      editorLabel="Markdown (used instead of the rich editor when filled)"
      editor={
        <Textarea
          value={markdownText}
          onChange={(e) => dispatch(setMarkdownText(e.target.value))}
          placeholder={"## Problem\nGiven an integer n, print n squared.\n\n## Input\nA single integer n."}
          className="h-full resize-none font-mono text-[13px]"
        />
      }
      preview={
        markdownText.trim() ? (
          <Markdown>{markdownText}</Markdown>
        ) : (
          <p className="text-sm text-muted-foreground">
            The rendered statement appears here as you type.
          </p>
        )
      }
    />
  );
}
