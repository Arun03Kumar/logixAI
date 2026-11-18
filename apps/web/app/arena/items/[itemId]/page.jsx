"use client";
import { useParams } from "next/navigation";
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

export default function ArenaItemPage() {
  const { itemId } = useParams();
  const { status } = useSession();
  const signedIn = status === "authenticated";
  const item = useApi(() => arenaApi.item(itemId), [itemId, status], { enabled: status !== "loading" });
  const it = item.data;
  const code = it && isCodeItem(it.type);

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
            </div>
            {code ? (
              // key: remount when moving between items so editor state resets.
              <CodePlayer key={it.id} item={it} signedIn={signedIn} onItemChange={item.setData} />
            ) : (
              <>
                <MathMarkdown>{it.prompt}</MathMarkdown>
                <AnswerPlayer key={it.id} item={it} signedIn={signedIn} onItemChange={item.setData} />
              </>
            )}
          </>
        )}
      </Container>
    </ArenaShell>
  );
}
