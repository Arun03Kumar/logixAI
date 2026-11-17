"use client";
import { useEffect, useSyncExternalStore } from "react";
import { useRouter, usePathname } from "next/navigation";
import {
  getServerSnapshot,
  getSnapshot,
  refreshSession,
  subscribe,
} from "./session";

/** { status: "loading" | "authenticated" | "anonymous", user } */
export function useSession() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

let bootstrapped = false;

/** Mount once (root layout): restores the session from the refresh cookie. */
export function SessionBootstrap() {
  useEffect(() => {
    if (bootstrapped) return;
    bootstrapped = true;
    refreshSession();
  }, []);
  return null;
}

/** Only allow same-site relative redirects (no "//evil.com"). */
export function safeNext(next, fallback = "/problems") {
  return typeof next === "string" && next.startsWith("/") && !next.startsWith("//")
    ? next
    : fallback;
}

/** Sends signed-out visitors to /login and back here afterwards. */
export function useRequireAuth() {
  const session = useSession();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (session.status === "anonymous") {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    }
  }, [session.status, router, pathname]);

  return session;
}
