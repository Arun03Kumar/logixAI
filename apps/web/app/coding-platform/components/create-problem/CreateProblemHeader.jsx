"use client";
import React from "react";
import { useSelector, useDispatch } from "react-redux";
import toast from "react-hot-toast";
import {
  Button,
  Container,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
  Tabs,
} from "@logixai/ui";
import {
  setActiveTab,
  setTitle,
  setDifficulty,
  publishProblem,
} from "@/app/coding-platform/store/createProblemSlice";

const TABS = [
  { value: "description", label: "Statement" },
  { value: "markdown", label: "Markdown" },
  { value: "testcases", label: "Test cases" },
  { value: "codestub", label: "Code stubs" },
];

export default function CreateProblemHeader() {
  const dispatch = useDispatch();
  const {
    activeTab,
    title,
    difficulty,
    description,
    markdownText,
    testCases,
    codeStubs,
    isPublishing,
  } = useSelector((state) => state.createProblem);

  const buildProblemPayload = () => {
    // Skip rows with neither input nor output; split examples from hidden tests.
    const cleaned = testCases
      .map((tc) => ({
        input: (tc.input || "").trim(),
        output: (tc.output || "").trim(),
        sample: Boolean(tc.sample),
      }))
      .filter((tc) => tc.input || tc.output);
    const strip = ({ input, output }) => ({ input, output });
    const sampleTestCases = cleaned.filter((tc) => tc.sample).map(strip);
    const hiddenTestCases = cleaned.filter((tc) => !tc.sample).map(strip);

    // codeStubs object -> array, skipping languages with nothing filled in
    const codeStubsArray = Object.entries(codeStubs || {})
      .filter(([, stub]) =>
        [stub.startSnippet, stub.endSnippet, stub.userSnippet].some((s) =>
          s?.trim(),
        ),
      )
      .map(([language, stub]) => ({
        language: language.toUpperCase(),
        startSnippet: stub.startSnippet || "",
        endSnippet: stub.endSnippet || "",
        userSnippet: stub.userSnippet || "",
      }));

    return {
      title: title.trim(),
      // Markdown tab wins when filled, otherwise the rich editor's output
      description: markdownText.trim() || description.trim(),
      difficulty,
      sampleTestCases,
      testCases: hiddenTestCases,
      codeStubs: codeStubsArray,
      editorial: "",
    };
  };

  const handlePublish = () => {
    const payload = buildProblemPayload();
    if (!payload.title) {
      toast.error("Add a title before publishing.");
      return;
    }
    if (!payload.description) {
      toast.error("Write the problem statement before publishing.");
      return;
    }
    if (payload.sampleTestCases.length + payload.testCases.length === 0) {
      toast.error("Add at least one test case.");
      return;
    }
    if (payload.sampleTestCases.length === 0) {
      toast.error("Mark at least one test case as an example so students can run their code.");
      return;
    }
    if (payload.codeStubs.length === 0) {
      toast.error("Add a code stub for at least one language.");
      return;
    }
    dispatch(publishProblem(payload));
  };

  return (
    <div className="sticky top-14 z-30 border-b border-border bg-background">
      <Container size="xl" className="flex flex-wrap items-center gap-3 pt-4">
        <Input
          aria-label="Problem title"
          placeholder="Problem title"
          value={title}
          onChange={(e) => dispatch(setTitle(e.target.value))}
          className="h-10 min-w-0 flex-1 border-transparent bg-transparent px-0 text-lg font-semibold hover:border-transparent focus-visible:border-transparent focus-visible:ring-0"
        />
        <Select
          value={difficulty}
          onValueChange={(v) => dispatch(setDifficulty(v))}
        >
          <SelectTrigger size="sm" className="w-28" aria-label="Difficulty">
            <SelectValue placeholder="Difficulty" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="easy">Easy</SelectItem>
            <SelectItem value="medium">Medium</SelectItem>
            <SelectItem value="hard">Hard</SelectItem>
          </SelectContent>
        </Select>
        <Button
          variant="primary"
          size="sm"
          onClick={handlePublish}
          disabled={isPublishing}
        >
          {isPublishing ? <Spinner className="text-primary-foreground" /> : null}
          {isPublishing ? "Publishing…" : "Publish"}
        </Button>
      </Container>
      <Container size="xl">
        <Tabs
          aria-label="Problem sections"
          items={TABS}
          value={activeTab}
          onValueChange={(tab) => dispatch(setActiveTab(tab))}
          className="mt-2 border-b-0"
        />
      </Container>
    </div>
  );
}
