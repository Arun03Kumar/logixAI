"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Container, cn } from "@logixai/ui";
import AppHeader from "@/app/components/layout/AppHeader";

const SECTIONS = [
  { label: "Learn", href: "/arena", match: (p) => p === "/arena" || /^\/arena\/(tracks|topics|items)/.test(p) },
  { label: "Problems", href: "/arena/problems", match: (p) => p.startsWith("/arena/problems") },
  { label: "Review", href: "/arena/review", match: (p) => p.startsWith("/arena/review") },
  { label: "Skill map", href: "/arena/skills", match: (p) => p.startsWith("/arena/skills") },
  { label: "My progress", href: "/arena/progress", match: (p) => p.startsWith("/arena/progress") },
  { label: "Lab", href: "/arena/lab/gradient-descent", match: (p) => p.startsWith("/arena/lab") },
];

/** App header plus ML Arena's own section links. */
export default function ArenaShell({ children, wide = false }) {
  const pathname = usePathname();
  return (
    <>
      <AppHeader />
      <div className="border-b border-border bg-card">
        <Container size="xl" className="flex h-11 items-center gap-1 overflow-x-auto text-sm">
          <span className="mr-3 shrink-0 font-semibold">ML Arena</span>
          {SECTIONS.map((s) => {
            const active = s.match(pathname);
            return (
              <Link
                key={s.href}
                href={s.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "shrink-0 rounded-md px-3 py-1 transition-colors",
                  active ? "bg-accent font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {s.label}
              </Link>
            );
          })}
        </Container>
      </div>
      <main className={cn(wide ? "py-4" : "py-8")}>{children}</main>
    </>
  );
}
