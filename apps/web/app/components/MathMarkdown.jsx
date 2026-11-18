"use client";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { cn } from "@logixai/ui";

const REMARK = [remarkGfm, remarkMath];
// KaTeX's `trust` stays off: \href, \htmlClass etc. render as plain text.
const REHYPE = [[rehypeKatex, { throwOnError: false, strict: "ignore" }]];

/**
 * remark-math only treats $$ as display maths when the dollars sit on their own
 * lines. Content writes one-line $$...$$ equations, so give them their own lines.
 * (In a replacement string "$$" means one literal "$", hence "$$$$".)
 */
const displayMath = (text) => text.replace(/^([ \t]*)\$\$(.+?)\$\$[ \t]*$/gm, "$1$$$$\n$1$2\n$1$$$$");

/**
 * Markdown with tables and $maths$ for ML Arena lessons and questions.
 * react-markdown never renders raw HTML, so content can't inject markup.
 * `inline` renders a short snippet (e.g. an answer option) without block spacing.
 */
export default function MathMarkdown({ children, className, inline = false }) {
  return (
    <div className={cn(inline ? "prose-content [&>p]:m-0 inline-block" : "prose-content", className)}>
      <ReactMarkdown remarkPlugins={REMARK} rehypePlugins={REHYPE}>
        {displayMath(children || "")}
      </ReactMarkdown>
    </div>
  );
}
