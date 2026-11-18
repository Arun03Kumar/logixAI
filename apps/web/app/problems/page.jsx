"use client";
import React from "react";
import Link from "next/link";
import { AlertCircle, ChevronRight, Code2, Plus } from "lucide-react";
import {
  Button,
  Card,
  Container,
  DifficultyBadge,
  EmptyState,
  PageHeader,
  Skeleton,
} from "@logixai/ui";
import AppHeader from "@/app/components/layout/AppHeader";
import LoadMore from "@/app/components/LoadMore";
import { usePagedApi } from "@/app/lib/api/usePagedApi";
import { PROBLEM_API_URL as API_BASE } from "@/app/coding-platform/lib/config";

/**
 * Plain-text preview of a markdown statement: drops code blocks, markdown
 * symbols, decorative rules/emoji and a leading repeat of the title.
 */
function summary(markdown, title = "") {
  let text = (markdown || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[─-╿]/g, " ")
    .replace(/\p{Extended_Pictographic}/gu, " ")
    .replace(/[#*_`>|~\-=]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const lowerTitle = title.trim().toLowerCase();
  if (lowerTitle && text.toLowerCase().startsWith(lowerTitle)) {
    text = text.slice(lowerTitle.length).trim();
  }
  return text.slice(0, 160);
}

const PAGE_SIZE = 50;

async function fetchProblems(cursor) {
  const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
  if (cursor) params.set("cursor", cursor);
  const res = await fetch(`${API_BASE}/problems?${params}`);
  if (!res.ok) throw new Error("Couldn't load problems");
  const body = await res.json();
  return { items: body?.data?.items ?? [], nextCursor: body?.data?.nextCursor ?? null };
}

export default function ProblemsListPage() {
  const list = usePagedApi(fetchProblems, []);
  const { loading, error, items: problems } = list;

  return (
    <>
      <AppHeader />
      <main className="py-10">
        <Container>
          <PageHeader
            title="Practice problems"
            description="Solve problems in Java, C++ or Python. Your code runs against hidden test cases and you get a verdict in seconds."
            actions={
              <Button asChild size="sm">
                <Link href="/create-problem">
                  <Plus />
                  Create problem
                </Link>
              </Button>
            }
          />

          <Card className="overflow-hidden">
            <div className="grid grid-cols-[1fr_auto] gap-4 border-b border-border bg-muted px-5 py-2.5 text-xs font-medium text-muted-foreground">
              <span>Problem</span>
              <span className="w-20 text-right">Difficulty</span>
            </div>

            {loading && (
              <ul className="divide-y divide-border">
                {[0, 1, 2, 3].map((i) => (
                  <li key={i} className="flex items-center gap-4 px-5 py-4">
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-4 w-1/3" />
                      <Skeleton className="h-3 w-2/3" />
                    </div>
                    <Skeleton className="h-5 w-14" />
                  </li>
                ))}
              </ul>
            )}

            {!loading && error && (
              <EmptyState
                icon={<AlertCircle />}
                title="Couldn't load problems"
                description="The problem service didn't respond. Check that it's running and try again."
                action={
                  <Button size="sm" onClick={() => window.location.reload()}>
                    Retry
                  </Button>
                }
              />
            )}

            {!loading && !error && problems.length === 0 && (
              <EmptyState
                icon={<Code2 />}
                title="Add your first problem"
                description="Problems you create appear here for students to practice."
                action={
                  <Button asChild variant="primary" size="sm">
                    <Link href="/create-problem">Create problem</Link>
                  </Button>
                }
              />
            )}

            {!loading && !error && problems.length > 0 && (
              <ul className="divide-y divide-border">
                {problems.map((p, index) => (
                  <li key={p._id}>
                    <Link
                      href={`/problems/${p._id}`}
                      className="group grid grid-cols-[1fr_auto] items-center gap-4 px-5 py-4 transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-foreground">
                          <span className="mr-2 font-mono text-xs font-normal text-muted-foreground">
                            {String(index + 1).padStart(2, "0")}
                          </span>
                          {p.title}
                        </p>
                        <p className="mt-1 line-clamp-1 text-sm text-muted-foreground">
                          {summary(p.description, p.title) || "No description"}
                        </p>
                      </div>
                      <div className="flex w-20 items-center justify-end gap-2">
                        <DifficultyBadge difficulty={p.difficulty} />
                        <ChevronRight className="size-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}

            {!loading && !error && <LoadMore list={list} />}
          </Card>
        </Container>
      </main>
    </>
  );
}
