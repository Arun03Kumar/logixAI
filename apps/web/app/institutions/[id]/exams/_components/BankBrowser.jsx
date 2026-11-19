"use client";
import { useState } from "react";
import toast from "react-hot-toast";
import { Search, Trash2 } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from "@logixai/ui";
import LoadMore from "@/app/components/LoadMore";
import { examApi } from "@/app/lib/api/exams";
import { usePagedApi } from "@/app/lib/api/usePagedApi";
import { DIFFICULTY, QUESTION_TYPE } from "@/app/lib/exams/format";

const ANY = "any";

/** First line of a prompt, without markdown clutter, for list rows. */
const preview = (prompt) => (prompt ?? "").replace(/[#*_`>]/g, "").trim().split("\n")[0] || "(no question text)";

/**
 * Searchable list of the institution's question bank.
 * - select mode (exam editor): tick questions, then onAdd(selected rows).
 * - manage mode (institution tab): delete your own (or, for admins, any) questions.
 */
export default function BankBrowser({ institutionId, mode = "manage", onAdd, canDelete, subjective = true }) {
  const [draftQuery, setDraftQuery] = useState("");
  const [filters, setFilters] = useState({ q: "", type: ANY, difficulty: ANY });
  const [picked, setPicked] = useState(() => new Map());
  const list = usePagedApi(
    (cursor) =>
      examApi.bank(institutionId, {
        cursor,
        q: filters.q || undefined,
        type: filters.type === ANY ? undefined : filters.type,
        difficulty: filters.difficulty === ANY ? undefined : filters.difficulty,
      }),
    [institutionId, filters.q, filters.type, filters.difficulty],
  );

  const toggle = (row) =>
    setPicked((m) => {
      const next = new Map(m);
      if (next.has(row.id)) next.delete(row.id);
      else next.set(row.id, row);
      return next;
    });

  const remove = async (row) => {
    if (!window.confirm("Remove this question from the bank? Exams that already use it keep their copy.")) return;
    try {
      await examApi.removeBankQuestion(institutionId, row.id);
      list.setItems((items) => items.filter((r) => r.id !== row.id));
      toast.success("Removed from the bank.");
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <div className="space-y-3">
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setFilters((f) => ({ ...f, q: draftQuery.trim() }));
        }}
      >
        <div className="relative min-w-48 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Search the question bank"
            placeholder="Search questions or topics"
            value={draftQuery}
            onChange={(e) => setDraftQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={filters.type} onValueChange={(type) => setFilters((f) => ({ ...f, type }))}>
          <SelectTrigger className="w-40" aria-label="Question type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>All types</SelectItem>
            {Object.entries(QUESTION_TYPE).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filters.difficulty} onValueChange={(difficulty) => setFilters((f) => ({ ...f, difficulty }))}>
          <SelectTrigger className="w-36" aria-label="Difficulty">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>Any difficulty</SelectItem>
            {Object.entries(DIFFICULTY).map(([value, d]) => (
              <SelectItem key={value} value={value}>
                {d.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button type="submit">Search</Button>
      </form>

      <Card className="overflow-hidden">
        {list.loading ? (
          <div className="space-y-2 p-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : list.error ? (
          <EmptyState title="Couldn't load the bank" description={list.error.message} />
        ) : list.items.length === 0 ? (
          <EmptyState
            title={filters.q || filters.type !== ANY || filters.difficulty !== ANY ? "No matching questions" : "The bank is empty"}
            description="Save questions from the exam editor (the book icon on a question) to reuse them in later exams."
          />
        ) : (
          <ul className="divide-y divide-border">
            {list.items.map((row) => {
              const blocked = mode === "select" && !subjective && (row.question.type === "short_answer" || row.question.type === "long_answer");
              const content = (
                <>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{preview(row.question.prompt)}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      <Badge tone="neutral">{QUESTION_TYPE[row.question.type] ?? row.question.type}</Badge>
                      {row.difficulty ? <Badge tone={DIFFICULTY[row.difficulty].tone}>{DIFFICULTY[row.difficulty].label}</Badge> : null}
                      <span>{row.question.marks} marks</span>
                      {row.topic ? <span>· {row.topic}</span> : null}
                      {row.tags.map((t) => (
                        <span key={t} className="rounded bg-muted px-1.5 py-0.5">
                          #{t}
                        </span>
                      ))}
                    </div>
                  </div>
                </>
              );
              return (
                <li key={row.id}>
                  {mode === "select" ? (
                    <label className={`flex items-start gap-3 px-4 py-3 ${blocked ? "opacity-50" : "cursor-pointer hover:bg-muted/50"}`}>
                      <input
                        type="checkbox"
                        className="mt-1 size-4 shrink-0 accent-primary"
                        checked={picked.has(row.id)}
                        disabled={blocked}
                        onChange={() => toggle(row)}
                        aria-label={`Pick: ${preview(row.question.prompt)}`}
                      />
                      {content}
                    </label>
                  ) : (
                    <div className="flex items-start gap-3 px-4 py-3">
                      {content}
                      {canDelete?.(row) ? (
                        <Button variant="ghost" size="icon-sm" aria-label="Remove from bank" onClick={() => remove(row)}>
                          <Trash2 />
                        </Button>
                      ) : null}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <LoadMore list={list} />
      </Card>

      {mode === "select" ? (
        <div className="flex items-center gap-3">
          <Button variant="primary" disabled={picked.size === 0} onClick={() => onAdd([...picked.values()])}>
            Add {picked.size || ""} {picked.size === 1 ? "question" : "questions"}
          </Button>
          {!subjective ? (
            <span className="text-xs text-muted-foreground">Written answers aren&apos;t switched on for your institution.</span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
