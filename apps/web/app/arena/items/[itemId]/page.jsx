"use client";
import { Suspense } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { RotateCcw } from "lucide-react";
import { Badge, Container, DifficultyBadge, EmptyState, Skeleton } from "@logixai/ui";
import MathMarkdown from "@/app/components/MathMarkdown";
import { arenaApi } from "@/app/lib/api/arena";
import { useApi } from "@/app/lib/api/useApi";
import { useSession } from "@/app/lib/auth/useSession";
import ArenaShell from "../../_components/ArenaShell";
import { Crumbs, StatusIcon } from "../../_components/bits";
import { ITEM_TYPE, isCodeItem } from "../../_components/labels";
import AnswerPlayer from "./AnswerPlayer";
import CodePlayer from "./CodePlayer";
import ProLock from "./ProLock";

const dayFmt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short" });

/** Review mode banner, or when the next review is for solved items. */
function ReviewLine({ item, reviewMode }) {
  if (reviewMode) {
    return (
      <p className="flex items-center gap-2 rounded-lg bg-info-soft px-4 py-2.5 text-sm">
        <RotateCcw className="size-4 shrink-0 text-info" />
        Review: answer from memory. Your earlier answer and the solution stay hidden until you get it right.
      </p>
    );
  }
  if (!item.review) return null;
  return (
    <p className="text-xs text-muted-foreground">
      {item.review.isDue ? "Due for review now." : `Next review ${dayFmt.format(new Date(item.review.due))}.`}
    </p>
  );
}

function ItemPage() {
  const { itemId } = useParams();
  const reviewMode = useSearchParams().get("review") === "1";
  const { status } = useSession();
  const signedIn = status === "authenticated";
  const item = useApi(() => arenaApi.item(itemId), [itemId, status], { enabled: status !== "loading" });
  const it = item.data;
  const code = it && isCodeItem(it.type) && !it.locked;
  // Review mode only makes sense for something already solved.
  const reviewing = reviewMode && it?.status === "solved";

  return (
    <ArenaShell wide={Boolean(code)}>
      <Container size={code ? "xl" : "md"} className="space-y-5">
        {!it ? (
          item.error ? (
            <EmptyState title="Problem not found" description={item.error.message} />
          ) : (
            <div className="space-y-3">
              <Skeleton className="h-6 w-1/3" />
              <Skeleton className="h-64" />
            </div>
          )
        ) : (
          <>
            <div className="space-y-2">
              <Crumbs
                items={[
                  { label: "ML Arena", href: "/arena" },
                  { label: it.topic.title, href: `/arena/topics/${it.topic.id}` },
                  { label: it.title },
                ]}
              />
              <div className="flex flex-wrap items-center gap-2">
                <StatusIcon status={it.status} className="size-5" />
                <h1 className="text-xl font-semibold">{it.title}</h1>
                <DifficultyBadge difficulty={it.difficulty} />
                <Badge tone="outline">{ITEM_TYPE[it.type]}</Badge>
                {it.access === "pro" ? <Badge tone="brand">Pro</Badge> : null}
              </div>
              {signedIn ? <ReviewLine item={it} reviewMode={reviewing} /> : null}
            </div>
            {it.locked ? (
              <ProLock item={it} signedIn={signedIn} />
            ) : code ? (
              // key: remount when moving between items so editor state resets.
              <CodePlayer key={it.id} item={it} signedIn={signedIn} onItemChange={item.setData} reviewMode={reviewing} />
            ) : (
              <>
                <MathMarkdown>{it.prompt}</MathMarkdown>
                <AnswerPlayer key={it.id} item={it} signedIn={signedIn} onItemChange={item.setData} reviewMode={reviewing} />
              </>
            )}
          </>
        )}
      </Container>
    </ArenaShell>
  );
}

export default function ArenaItemPage() {
  // useSearchParams needs a Suspense boundary for static rendering.
  return (
    <Suspense fallback={null}>
      <ItemPage />
    </Suspense>
  );
}
