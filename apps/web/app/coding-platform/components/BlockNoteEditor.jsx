"use client";
import React, { useEffect } from "react";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/shadcn";
import { useTheme } from "@logixai/ui";
import "@blocknote/shadcn/style.css";

/**
 * Rich-text statement editor. Fills its parent's height and scrolls inside;
 * emits markdown on every change.
 */
export default function BlockNoteEditor({ onMarkdownChange }) {
  const editor = useCreateBlockNote();
  const { theme } = useTheme();

  useEffect(() => {
    if (!editor) return;
    const off = editor.onChange(async () => {
      try {
        onMarkdownChange?.(await editor.blocksToMarkdownLossy(editor.document));
      } catch {
        onMarkdownChange?.("");
      }
    });
    return () => {
      off?.();
    };
  }, [editor, onMarkdownChange]);

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-lg border border-border bg-card">
      <div className="min-h-0 flex-1">
        <BlockNoteView
          editor={editor}
          theme={theme}
          className="h-full w-full overflow-auto py-4 [&_.bn-editor]:h-full [&_.bn-editor]:bg-transparent [&_.bn-editor]:font-sans"
        />
      </div>
    </div>
  );
}
