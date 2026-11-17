"use client";
import React, { useEffect, useSyncExternalStore } from "react";
import { Sun, Moon } from "lucide-react";

// Theme lives in localStorage; useSyncExternalStore reads it without a
// setState-in-effect, and uses "light" during server render / hydration.
const STORAGE_KEY = "theme";
const listeners = new Set();

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "dark" || stored === "light") return stored;
  } catch {
    // storage blocked
  }
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function getServerSnapshot() {
  return "light";
}

function storeTheme(theme) {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // storage blocked: the toggle still works for this page view
  }
  listeners.forEach((listener) => listener());
}

export default function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  return (
    <button
      aria-label="Toggle theme"
      onClick={() => storeTheme(theme === "dark" ? "light" : "dark")}
      className="p-2 rounded-md hover:bg-muted/50"
    >
      {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  );
}
