"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useApi } from "./useApi";

/**
 * For endpoints that return `{ items, nextCursor, ...extra }`.
 * `loadPage(cursor)` fetches one page (cursor is undefined for the first).
 *
 * Returns everything `useApi` does, plus:
 *   items, setItems    the rows loaded so far
 *   hasMore, loadMore  fetch and append the next page
 *   loadingMore, moreError
 */
export function usePagedApi(loadPage, deps, options) {
  const loadRef = useRef(loadPage);
  useEffect(() => {
    loadRef.current = loadPage;
  });
  const api = useApi(() => loadRef.current(undefined), deps, options);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState(null);

  const { data, setData } = api;
  const cursor = data?.nextCursor ?? null;

  const loadMore = useCallback(async () => {
    if (!cursor) return;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const page = await loadRef.current(cursor);
      // Ignore the page if the list was reloaded meanwhile.
      setData((current) =>
        current?.nextCursor === cursor
          ? { ...current, ...page, items: [...current.items, ...page.items] }
          : current,
      );
    } catch (err) {
      setMoreError(err);
    } finally {
      setLoadingMore(false);
    }
  }, [cursor, setData]);

  const setItems = useCallback(
    (update) =>
      setData((current) =>
        current
          ? { ...current, items: typeof update === "function" ? update(current.items) : update }
          : current,
      ),
    [setData],
  );

  return {
    ...api,
    items: data?.items ?? [],
    setItems,
    hasMore: Boolean(cursor),
    loadMore,
    loadingMore,
    moreError,
  };
}
