"use client";
import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";

/**
 * The practice platform's areas. Each has its own base path, title and menu;
 * the item, track, topic and problem-list pages are shared and take their
 * links from the area in the URL (see useArea).
 */
export const AREAS = {
  ml: {
    id: "ml",
    title: "ML Arena",
    base: "/arena",
    tagline: "Maths, Python, data, machine learning, deep learning and LLMs.",
    sections: [
      { label: "Learn", path: "", match: (rest) => rest === "" || /^\/(tracks|topics|items|course)/.test(rest) },
      { label: "Problems", path: "/problems" },
      { label: "Review", path: "/review" },
      { label: "Skill map", path: "/skills" },
      { label: "My progress", path: "/progress" },
      { label: "Lab", path: "/lab/gradient-descent", match: (rest) => rest.startsWith("/lab") },
    ],
  },
  frontend: {
    id: "frontend",
    title: "Frontend",
    base: "/frontend",
    tagline: "JavaScript and React interview problems, judged on hidden tests, plus a live playground.",
    sections: [
      { label: "Learn", path: "", match: (rest) => rest === "" || /^\/(tracks|topics|items)/.test(rest) },
      { label: "Problems", path: "/problems" },
      { label: "Playground", path: "/playground" },
    ],
  },
  "system-design": {
    id: "system-design",
    title: "System design",
    base: "/system-design",
    tagline: "Build rate limiters, load balancers and caches against simulated traffic, and practise design write-ups.",
    sections: [
      { label: "Learn", path: "", match: (rest) => rest === "" || /^\/(tracks|topics|items)/.test(rest) },
      { label: "Problems", path: "/problems" },
    ],
  },
};

const ORDER = ["frontend", "system-design", "ml"];

/** The area a path belongs to (ML Arena by default). */
export function areaFromPath(pathname = "") {
  for (const id of ORDER) {
    const { base } = AREAS[id];
    if (pathname === base || pathname.startsWith(`${base}/`)) return AREAS[id];
  }
  return AREAS.ml;
}

export function useArea() {
  return areaFromPath(usePathname() ?? "");
}

const baseOf = (area) => (AREAS[area] ?? AREAS.ml).base;
export const itemHref = (area, id, query = "") => `${baseOf(area)}/items/${id}${query}`;
export const topicHref = (area, id) => `${baseOf(area)}/topics/${id}`;
export const trackHref = (area, id) => `${baseOf(area)}/tracks/${id}`;

/**
 * Shared pages: once the data says which area it belongs to, move to that
 * area's URL if this isn't it (old /arena links to a React problem land on
 * /frontend/...).
 */
export function useAreaRedirect(dataArea) {
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const current = areaFromPath(pathname);
  useEffect(() => {
    if (!dataArea || !AREAS[dataArea] || dataArea === current.id) return;
    router.replace(`${AREAS[dataArea].base}${pathname.slice(current.base.length)}${window.location.search}`);
  }, [dataArea, current, pathname, router]);
}
