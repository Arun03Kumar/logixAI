"use client";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Runs an async loader when `enabled` and whenever `deps` change.
 * Returns { data, error, loading, reload, setData }.
 *
 * `loading` is derived (the latest request hasn't answered yet) rather than
 * set inside the effect, so there are no cascading renders.
 */
export function useApi(loader, deps, { enabled = true } = {}) {
  const depsKey = JSON.stringify(deps);
  const [nonce, setNonce] = useState(0);
  const requestKey = `${depsKey}#${nonce}`;
  const [result, setResult] = useState({ key: null, data: null, error: null });

  const loaderRef = useRef(loader);
  useEffect(() => {
    loaderRef.current = loader;
  });

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    loaderRef.current().then(
      (data) => {
        if (!cancelled) setResult({ key: requestKey, data, error: null });
      },
      (error) => {
        if (!cancelled) setResult((r) => ({ key: requestKey, data: r.data, error }));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [enabled, requestKey]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  const setData = useCallback(
    (update) =>
      setResult((r) => ({
        ...r,
        data: typeof update === "function" ? update(r.data) : update,
      })),
    [],
  );

  const loading = enabled && result.key !== requestKey;
  return {
    data: result.data,
    error: loading ? null : result.error,
    loading,
    reload,
    setData,
  };
}
