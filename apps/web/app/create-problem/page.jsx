"use client";
import React from "react";
import { useSelector } from "react-redux";
import { Container } from "@logixai/ui";
import AppHeader from "@/app/components/layout/AppHeader";
import RequireAuth from "@/app/components/layout/RequireAuth";
import CreateProblemHeader from "@/app/coding-platform/components/create-problem/CreateProblemHeader";
import CreateQuestionButton from "@/app/coding-platform/components/create-problem/CreateQuestionButton";
import TabContent from "@/app/coding-platform/components/create-problem/TabContent";
import { useCreateProblemNotifications } from "@/app/coding-platform/hooks/useCreateProblemNotifications";

function CreateProblemWorkspace() {
  const showEditor = useSelector((state) => state.createProblem.showEditor);

  // Success / error toasts for publishing
  useCreateProblemNotifications();

  return (
    <>
      {showEditor && <CreateProblemHeader />}
      <main className="flex-1 py-8">
        <Container size="xl">
          {!showEditor ? <CreateQuestionButton /> : <TabContent />}
        </Container>
      </main>
    </>
  );
}

export default function CreateProblem() {
  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader />
      <RequireAuth role="admin">
        <CreateProblemWorkspace />
      </RequireAuth>
    </div>
  );
}
