"use client";
import React from "react";

/** Two-pane authoring layout: editor on the left, live preview on the right. */
export default function EditorPreviewLayout({
  editorLabel,
  editor,
  previewLabel = "Preview",
  preview,
}) {
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)]">
      <section className="flex min-w-0 flex-col gap-2">
        <h2 className="text-sm font-medium text-muted-foreground">
          {editorLabel}
        </h2>
        <div className="h-[70vh] min-h-0">{editor}</div>
      </section>
      <section className="flex min-w-0 flex-col gap-2">
        <h2 className="text-sm font-medium text-muted-foreground">
          {previewLabel}
        </h2>
        <div className="h-[70vh] overflow-auto rounded-lg border border-border bg-card p-5">
          {preview}
        </div>
      </section>
    </div>
  );
}
