"use client";
import React from "react";
import { useDispatch } from "react-redux";
import { FileCode2, ListChecks, PenLine, Plus } from "lucide-react";
import { Button, Card } from "@logixai/ui";
import { setShowEditor } from "@/app/coding-platform/store/createProblemSlice";

const STEPS = [
  {
    icon: PenLine,
    title: "Write the statement",
    body: "Use the rich editor or paste markdown.",
  },
  {
    icon: ListChecks,
    title: "Add test cases",
    body: "Inputs and expected outputs the judge checks against.",
  },
  {
    icon: FileCode2,
    title: "Set up code stubs",
    body: "Starter code and hidden driver code per language.",
  },
];

export default function CreateQuestionButton() {
  const dispatch = useDispatch();

  return (
    <div className="mx-auto max-w-2xl py-10">
      <h1 className="text-2xl font-semibold">Create a problem</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Publish a coding problem for students to practice. It takes three
        steps.
      </p>
      <Card className="mt-8 divide-y divide-border">
        {STEPS.map(({ icon: Icon, title, body }, i) => (
          <div key={title} className="flex items-start gap-4 p-5">
            <span className="grid size-9 shrink-0 place-items-center rounded-md bg-primary-soft text-primary-soft-foreground">
              <Icon className="size-4" />
            </span>
            <div>
              <p className="text-sm font-semibold">
                {i + 1}. {title}
              </p>
              <p className="mt-0.5 text-sm text-muted-foreground">{body}</p>
            </div>
          </div>
        ))}
      </Card>
      <Button
        variant="primary"
        className="mt-6"
        onClick={() => dispatch(setShowEditor(true))}
      >
        <Plus />
        Start a new problem
      </Button>
    </div>
  );
}
