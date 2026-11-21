"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Container, cn } from "@logixai/ui";
import AppHeader from "@/app/components/layout/AppHeader";
import { areaFromPath } from "@/app/lib/areas";

/**
 * App header plus the current area's own menu (ML Arena, Frontend or System
 * design), chosen from the URL so shared pages show the right one.
 */
export default function ArenaShell({ children, wide = false }) {
  const pathname = usePathname() ?? "";
  const area = areaFromPath(pathname);
  const rest = pathname.slice(area.base.length);
  return (
    <>
      <AppHeader />
      <div className="border-b border-border bg-card">
        <Container size="xl" className="flex h-11 items-center gap-1 overflow-x-auto text-sm">
          <Link href={area.base} className="mr-3 shrink-0 font-semibold">
            {area.title}
          </Link>
          {area.sections.map((s) => {
            const href = `${area.base}${s.path}`;
            const active = s.match ? s.match(rest) : rest.startsWith(s.path);
            return (
              <Link
                key={href}
                href={href}
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
