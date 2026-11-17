"use client";
import React from "react";
import ReactMarkdown from "react-markdown";
import DOMPurify from "dompurify";
import { cn } from "@logixai/ui";

/**
 * Renders a problem statement / preview. Styling lives in `.prose-content`
 * (app/globals.css) so every markdown surface looks the same.
 */
export default function Markdown({ children, className }) {
  return (
    <div className={cn("prose-content", className)}>
      <ReactMarkdown>{DOMPurify.sanitize(children || "")}</ReactMarkdown>
    </div>
  );
}
