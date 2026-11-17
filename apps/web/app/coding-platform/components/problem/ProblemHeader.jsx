"use client";
import React from "react";
import Link from "next/link";
import { useSelector, useDispatch } from "react-redux";
import toast from "react-hot-toast";
import { ChevronLeft, Play, Send } from "lucide-react";
import {
  Button,
  Logo,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
  ThemeToggle,
} from "@logixai/ui";
import { listLanguages } from "@logixai/languages";
import { setLanguage } from "@/app/coding-platform/store/problemSlice";
import {
  runCode,
  submitCode,
} from "@/app/coding-platform/store/runOutputSlice";

export default function ProblemHeader({ problemId }) {
  const dispatch = useDispatch();
  const problem = useSelector((state) => state.problem.data);
  const language = useSelector((state) => state.problem.language);
  const userCode = useSelector((state) => state.problem.userCode);
  const isRunning = useSelector((state) => state.runOutput.isRunning);
  const isSubmitting = useSelector((state) => state.runOutput.isSubmitting);

  // The verdict arrives later over the socket (see socketService); here we
  // only report failures to queue the submission.
  const send = async (action) => {
    try {
      const result = await dispatch(
        action({ id: problemId, userCode, language }),
      ).unwrap();
      if (result?.success === false) {
        toast.error(result.message || "Couldn't submit your code. Try again.");
      }
    } catch {
      toast.error("Couldn't reach the judge. Try again.");
    }
  };

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-background px-3 sm:px-4">
      <Link href="/" aria-label="LogixAI home" className="hidden sm:block">
        <Logo showMark className="text-[15px]" />
      </Link>
      <span className="hidden h-5 w-px bg-border sm:block" aria-hidden="true" />
      <Button asChild variant="ghost" size="sm" className="px-2">
        <Link href="/problems">
          <ChevronLeft />
          Problems
        </Link>
      </Button>
      <h1 className="min-w-0 flex-1 truncate text-sm font-semibold">
        {problem?.title || ""}
      </h1>

      <Select
        value={language}
        onValueChange={(next) => dispatch(setLanguage(next))}
      >
        <SelectTrigger size="sm" className="w-28" aria-label="Language">
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
      <Button
        size="sm"
        disabled={isRunning || isSubmitting}
        onClick={() => send(runCode)}
      >
        {isRunning ? <Spinner /> : <Play />}
        Run
      </Button>
      <Button
        size="sm"
        variant="primary"
        disabled={isRunning || isSubmitting}
        onClick={() => send(submitCode)}
      >
        {isSubmitting ? <Spinner className="text-primary-foreground" /> : <Send />}
        Submit
      </Button>
      <ThemeToggle />
    </header>
  );
}
