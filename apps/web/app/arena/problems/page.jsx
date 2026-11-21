"use client";
import { itemHref, useArea } from "@/app/lib/areas";
import { Suspense, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ListChecks, Lock, Search, X } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  Container,
  DifficultyBadge,
  EmptyState,
  Input,
  PageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  cn,
} from "@logixai/ui";
import { arenaApi } from "@/app/lib/api/arena";
import { useApi } from "@/app/lib/api/useApi";
import { useSession } from "@/app/lib/auth/useSession";
import ArenaShell from "../_components/ArenaShell";
import { StatusIcon } from "../_components/bits";
import { ITEM_TYPE } from "../_components/labels";

const ANY = "any";
const FILTERS = ["q", "type", "difficulty", "status", "track", "tag", "list"];

/** Kinds of problem, grouped the way learners think about them. */
const KINDS = [
  { value: "sql", label: "SQL" },
  { value: "code", label: "Code" },
  { value: "debug", label: "Debug" },
  { value: "design", label: "Design question" },
  { value: "mcq_single", label: "Single choice" },
  { value: "mcq_multi", label: "Multiple choice" },
  { value: "numeric", label: "Numeric" },
  { value: "output", label: "Predict the output" },
];
const DIFFICULTIES = ["easy", "medium", "hard", "expert"];
const STATUSES = [
  { value: "todo", label: "Not solved" },
  { value: "attempted", label: "Attempted" },
  { value: "solved", label: "Solved" },
];

function FilterSelect({ label, value, onChange, options, allLabel }) {
  return (
    <Select value={value ?? ANY} onValueChange={(v) => onChange(v === ANY ? undefined : v)}>
      <SelectTrigger className="w-40" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ANY}>{allLabel}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function ListCards({ lists, active, onPick }) {
  if (!lists.length) return null;
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      {lists.map((l) => {
        const on = active === l.id;
        return (
          <button
            key={l.id}
            type="button"
            onClick={() => onPick(on ? undefined : l.id)}
            aria-pressed={on}
            className={cn(
              "flex flex-col gap-2 rounded-lg border p-4 text-left transition-colors",
              on ? "border-primary bg-primary-soft" : "border-border bg-card hover:bg-accent",
            )}
          >
            <span className="flex items-center gap-2 text-sm font-semibold">
              <ListChecks className="size-4 shrink-0 text-primary" />
              {l.title}
            </span>
            <span className="line-clamp-3 text-xs text-muted-foreground">{l.summary}</span>
            <span className="mt-auto text-xs font-medium tabular-nums">
              {l.solvedCount} / {l.itemCount} solved
            </span>
          </button>
        );
      })}
    </div>
  );
}

const PROBLEMS_BLURB = {
  ml: "Every ML Arena problem in one place — maths, Python, SQL, Pandas, NumPy, ML, PyTorch and LLMs — with filters and curated interview lists.",
  frontend: "Every JavaScript and React problem, with filters and curated lists.",
  "system-design": "Every system design problem — runnable components, estimates and design questions.",
};

function ProblemsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { status } = useSession();
  const signedIn = status === "authenticated";
  const filters = Object.fromEntries(FILTERS.map((k) => [k, params.get(k) ?? undefined]));
  const [query, setQuery] = useState(filters.q ?? "");
  const key = params.toString();

  // Each area has its own problem list: only its problems, lists and tracks.
  const area = useArea();
  const problems = useApi(() => arenaApi.problems({ ...filters, area: area.id }), [key, status, area.id], { enabled: status !== "loading" });
  const lists = useApi(() => arenaApi.lists(area.id), [status, area.id], { enabled: status !== "loading" });
  const tracks = useApi(() => arenaApi.tracks(area.id), [area.id]);

  const setFilter = (name, value) => {
    const next = new URLSearchParams(params);
    if (value) next.set(name, value);
    else next.delete(name);
    router.replace(`${pathname}${next.size ? `?${next}` : ""}`, { scroll: false });
  };
  const clear = () => {
    setQuery("");
    router.replace(pathname, { scroll: false });
  };
  const anyFilter = FILTERS.some((k) => filters[k]);
  const data = problems.data;
  const activeList = lists.data?.find((l) => l.id === filters.list);

  return (
    <ArenaShell>
      <Container size="xl" className="space-y-6">
        <PageHeader
          title="Problems"
          description={PROBLEMS_BLURB[area.id]}
        />

        <ListCards lists={lists.data ?? []} active={filters.list} onPick={(id) => setFilter("list", id)} />

        <div className="flex flex-wrap items-center gap-2">
          <form
            className="relative min-w-56 flex-1"
            onSubmit={(e) => {
              e.preventDefault();
              setFilter("q", query.trim() || undefined);
            }}
          >
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label="Search problems"
              placeholder="Search titles and tags, then press Enter"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-9"
            />
          </form>
          <FilterSelect
            label="Track"
            value={filters.track}
            onChange={(v) => setFilter("track", v)}
            allLabel="All tracks"
            options={(tracks.data ?? []).map((t) => ({ value: t.id, label: t.title }))}
          />
          <FilterSelect label="Kind" value={filters.type} onChange={(v) => setFilter("type", v)} allLabel="All kinds" options={KINDS} />
          <FilterSelect
            label="Difficulty"
            value={filters.difficulty}
            onChange={(v) => setFilter("difficulty", v)}
            allLabel="Any difficulty"
            options={DIFFICULTIES.map((d) => ({ value: d, label: d[0].toUpperCase() + d.slice(1) }))}
          />
          {signedIn ? (
            <FilterSelect label="Status" value={filters.status} onChange={(v) => setFilter("status", v)} allLabel="Any status" options={STATUSES} />
          ) : null}
          {anyFilter ? (
            <Button variant="ghost" size="sm" onClick={clear}>
              <X />
              Clear
            </Button>
          ) : null}
        </div>

        {filters.tag || activeList ? (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {activeList ? <Badge tone="brand">List: {activeList.title}</Badge> : null}
            {filters.tag ? (
              <button type="button" onClick={() => setFilter("tag", undefined)} className="inline-flex items-center gap-1">
                <Badge tone="outline">
                  #{filters.tag}
                  <X className="size-3" />
                </Badge>
              </button>
            ) : null}
          </div>
        ) : null}

        <Card className="overflow-hidden">
          {problems.loading && !data ? (
            <div className="space-y-2 p-4">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : problems.error ? (
            <EmptyState title="Couldn't load problems" description={problems.error.message} />
          ) : !data?.items.length ? (
            <EmptyState title="No problems match" description="Try fewer filters." />
          ) : (
            <>
              <div className="flex items-center justify-between border-b border-border px-4 py-2.5 text-xs text-muted-foreground">
                <span>
                  {data.total} {data.total === 1 ? "problem" : "problems"}
                  {signedIn ? ` · ${data.solved} solved` : ""}
                </span>
              </div>
              <ul className="divide-y divide-border">
                {data.items.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
                    <StatusIcon status={p.status} />
                    <Link href={itemHref(p.area, p.id)} className="min-w-0 flex-1 truncate text-sm font-medium hover:text-primary">
                      {p.title}
                    </Link>
                    {p.access === "pro" ? (
                      <Badge tone="brand">
                        <Lock className="size-3" />
                        Pro
                      </Badge>
                    ) : null}
                    <span className="hidden text-xs text-muted-foreground md:inline">{p.topic.title}</span>
                    <Badge tone="outline">{ITEM_TYPE[p.type] ?? p.type}</Badge>
                    <DifficultyBadge difficulty={p.difficulty} />
                    <span className="hidden w-full flex-wrap gap-1 pl-7 sm:flex">
                      {p.tags.slice(0, 4).map((t) => (
                        <button
                          key={t}
                          type="button"
                          onClick={() => setFilter("tag", t)}
                          className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground hover:text-foreground"
                        >
                          #{t}
                        </button>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      </Container>
    </ArenaShell>
  );
}

export default function ArenaProblemsPage() {
  // useSearchParams needs a Suspense boundary for static rendering.
  return (
    <Suspense fallback={null}>
      <ProblemsPage />
    </Suspense>
  );
}
