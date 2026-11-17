"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Container, Logo, ThemeToggle, cn } from "@logixai/ui";

const NAV = [
  { label: "Practice", href: "/problems" },
  { label: "Create problem", href: "/create-problem" },
];

/** Header for signed-in app pages (practice, authoring, later courses and tests). */
export default function AppHeader() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/75">
      <Container size="xl" className="flex h-14 items-center gap-8">
        <Link href="/" aria-label="LogixAI home">
          <Logo />
        </Link>
        <nav className="flex items-center gap-1 text-sm font-medium">
          {NAV.map(({ label, href }) => {
            const active = pathname === href || pathname.startsWith(`${href}/`);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "rounded-md px-3 py-1.5 transition-colors",
                  active
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto">
          <ThemeToggle />
        </div>
      </Container>
    </header>
  );
}
