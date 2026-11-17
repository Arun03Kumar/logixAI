"use client";
import React, { useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useParams } from "next/navigation";
import { AlertCircle } from "lucide-react";
import { DifficultyBadge, EmptyState, Skeleton } from "@logixai/ui";
import Markdown from "@/app/coding-platform/components/Markdown";
import { clearRunOutput } from "@/app/coding-platform/store/runOutputSlice";

export default function ProblemDescription() {
  const problem = useSelector((state) => state.problem.data);
  const loading = useSelector((state) => state.problem.loading);
  const error = useSelector((state) => state.problem.error);
  const dispatch = useDispatch();
  const { id } = useParams();

  useEffect(() => {
    dispatch(clearRunOutput());
  }, [id, dispatch]);

  return (
    <section className="flex h-full min-h-0 flex-col border-border bg-background lg:w-[44%] lg:border-r xl:w-[40%]">
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
        {loading && (
          <div className="space-y-3">
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-4 w-16" />
            <Skeleton className="mt-6 h-4 w-full" />
            <Skeleton className="h-4 w-11/12" />
            <Skeleton className="h-4 w-4/5" />
          </div>
        )}

        {!loading && error && (
          <EmptyState
            icon={<AlertCircle />}
            title="Couldn't load this problem"
            description="It may have been deleted, or the problem service isn't running."
          />
        )}

        {!loading && !error && problem && (
          <article>
            <h2 className="text-xl font-semibold">{problem.title}</h2>
            <div className="mt-2 flex items-center gap-2">
              <DifficultyBadge difficulty={problem.difficulty} />
            </div>
            <Markdown className="mt-6">{problem.description}</Markdown>
          </article>
        )}
      </div>
    </section>
  );
}
