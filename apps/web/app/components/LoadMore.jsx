"use client";
import { Button } from "@logixai/ui";

/** Footer for a list from `usePagedApi`: a "Load more" button while there are more pages. */
export default function LoadMore({ list, label = "Load more" }) {
  if (!list.hasMore) return null;
  return (
    <div className="flex items-center justify-center gap-3 border-t border-border px-5 py-3">
      {list.moreError ? <span className="text-sm text-danger">{list.moreError.message}</span> : null}
      <Button variant="secondary" size="sm" onClick={list.loadMore} disabled={list.loadingMore}>
        {list.loadingMore ? "Loading…" : label}
      </Button>
    </div>
  );
}
