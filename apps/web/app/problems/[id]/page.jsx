"use client";
import React, { useEffect } from "react";
import { useParams } from "next/navigation";
import { useDispatch } from "react-redux";
import { fetchProblem } from "@/app/coding-platform/store/problemSlice";
import { DEFAULT_LANGUAGE } from "@logixai/languages";
import {
  initializeSocket,
  disconnectSocket,
} from "@/app/coding-platform/services/socketService";
import { useSession } from "@/app/lib/auth/useSession";
import ProblemHeader from "@/app/coding-platform/components/problem/ProblemHeader";
import ProblemDescription from "@/app/coding-platform/components/problem/ProblemDescription";
import CodeEditor from "@/app/coding-platform/components/problem/CodeEditor";
import OutputTabs from "@/app/coding-platform/components/problem/OutputTabs";

export default function ProblemDetailPage() {
  const params = useParams();
  const dispatch = useDispatch();
  const { status } = useSession();
  const id = params?.id;

  useEffect(() => {
    if (id) dispatch(fetchProblem({ id, language: DEFAULT_LANGUAGE }));
  }, [id, dispatch]);

  // Results arrive over the socket, which needs a signed-in user.
  useEffect(() => {
    if (status !== "authenticated") return;
    initializeSocket(dispatch);
    return () => disconnectSocket();
  }, [status, dispatch]);

  if (!id) return null;

  return (
    <div className="flex h-screen flex-col bg-background">
      <ProblemHeader problemId={id} />
      <main className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <ProblemDescription />
        <section className="flex min-h-0 flex-1 flex-col bg-card">
          <CodeEditor />
          <OutputTabs />
        </section>
      </main>
    </div>
  );
}
