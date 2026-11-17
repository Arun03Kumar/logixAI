"use client";

import * as React from "react";
import { Moon, Sun } from "lucide-react";
import { cn } from "../lib/cn";

/*
 * Theme lives in localStorage ("theme" = "light" | "dark") and is applied as
 * the `dark` class on <html>. ThemeScript applies it before first paint;
 * useSyncExternalStore keeps the toggle in sync without setState-in-effect.
 */
const STORAGE_KEY = "theme";
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): "light" | "dark" {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

function getServerSnapshot(): "light" | "dark" {
  return "light";
}

function setTheme(theme: "light" | "dark") {
  document.documentElement.classList.toggle("dark", theme === "dark");
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // storage blocked: the toggle still works for this page view
  }
  listeners.forEach((listener) => listener());
}

export function useTheme() {
  const theme = React.useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );
  return { theme, setTheme };
}

export function ThemeToggle({ className }: { className?: string }) {
  const { theme } = useTheme();
  const next = theme === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
      onClick={() => setTheme(next)}
      className={cn(
        "grid size-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
        className,
      )}
    >
      {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </button>
  );
}

/**
 * Inline script for <head>: applies the saved (or system) theme before the
 * first paint so there is no light/dark flash.
 */
export function ThemeScript() {
  const code = `(function(){try{var t=localStorage.getItem('${STORAGE_KEY}');if(t!=='light'&&t!=='dark'){t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}if(t==='dark')document.documentElement.classList.add('dark')}catch(e){}})();`;
  return <script dangerouslySetInnerHTML={{ __html: code }} />;
}
