"use client";
import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { examApi } from "@/app/lib/api/exams";

const MESSAGES = {
  tab_hidden: "You left the exam tab. This has been recorded.",
  fullscreen_exit: "You exited fullscreen. This has been recorded.",
  copy: "Copying is disabled during this exam.",
  paste: "Pasting is disabled during this exam.",
};

/**
 * Browser-level integrity signals while an attempt is in progress:
 * tab switches, leaving fullscreen and copy/paste (blocked when configured).
 * Every event is sent to exam-service for the instructor to review.
 *
 * Returns { eventCount, fullscreenLost, enterFullscreen }.
 */
export function useProctoring({ attemptId, active, requireFullscreen, blockCopyPaste, initialCount }) {
  const [eventCount, setEventCount] = useState(initialCount ?? 0);
  const [fullscreenLost, setFullscreenLost] = useState(false);
  const lastSent = useRef({});

  useEffect(() => {
    if (!active || !attemptId) return undefined;

    const report = (type) => {
      // Ignore bursts of the same event (e.g. several paste keystrokes).
      const now = Date.now();
      if (now - (lastSent.current[type] ?? 0) < 1500) return;
      lastSent.current[type] = now;
      setEventCount((n) => n + 1);
      toast.error(MESSAGES[type], { id: `proctor-${type}` });
      examApi.event(attemptId, type).catch(() => {});
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden") report("tab_hidden");
    };
    const onFullscreen = () => {
      if (requireFullscreen && !document.fullscreenElement) {
        setFullscreenLost(true);
        report("fullscreen_exit");
      } else {
        setFullscreenLost(false);
      }
    };
    // Capture phase + stopPropagation so the code editor never sees the event.
    const block = (type) => (e) => {
      e.preventDefault();
      e.stopPropagation();
      report(type);
    };
    const onCopy = block("copy");
    const onCut = block("copy");
    const onPaste = block("paste");

    document.addEventListener("visibilitychange", onVisibility);
    document.addEventListener("fullscreenchange", onFullscreen);
    if (blockCopyPaste) {
      window.addEventListener("copy", onCopy, true);
      window.addEventListener("cut", onCut, true);
      window.addEventListener("paste", onPaste, true);
    }
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      document.removeEventListener("fullscreenchange", onFullscreen);
      window.removeEventListener("copy", onCopy, true);
      window.removeEventListener("cut", onCut, true);
      window.removeEventListener("paste", onPaste, true);
    };
  }, [active, attemptId, requireFullscreen, blockCopyPaste]);

  const enterFullscreen = () =>
    document.documentElement.requestFullscreen?.().then(
      () => setFullscreenLost(false),
      () => {},
    );

  return { eventCount, fullscreenLost, enterFullscreen };
}

export function exitFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
}
