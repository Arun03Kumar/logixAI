"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Container, Logo, ThemeToggle, cn } from "@logixai/ui";
import { useSession } from "@/app/lib/auth/useSession";
import UserMenu from "./UserMenu";
import { isPro } from "@/app/lib/billing/plan";

type NavItem = { label: string; href: string; when?: "signedIn" | "admin" | "notPro"; also?: string[] };

// One entry per area (ML Arena, DSA, Frontend, System design), then Practice:
// mock interviews, contests and profiles across all of them.
const NAV: NavItem[] = [
  { label: "ML Arena", href: "/arena" },
  { label: "DSA", href: "/problems" },
  { label: "Frontend", href: "/frontend" },
  { label: "System design", href: "/system-design" },
  { label: "Practice", href: "/practice", also: ["/u"] },
  { label: "Institutions", href: "/institutions", when: "signedIn" },
  { label: "Create problem", href: "/create-problem", when: "admin" },
  { label: "Pricing", href: "/pricing", when: "notPro" },
];

/** Header for app pages (practice, institutions, authoring). */
export default function AppHeader() {
  const pathname = usePathname();
  const { status, user } = useSession();

  const visible = NAV.filter(
    (item) =>
      !item.when ||
      (item.when === "signedIn" && status === "authenticated") ||
      (item.when === "admin" && user?.role === "admin") ||
      (item.when === "notPro" && status !== "loading" && !isPro(user)),
  );

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/75">
      <Container size="xl" className="flex h-14 items-center gap-8">
        <Link href="/" aria-label="LogixAI home">
          <Logo />
        </Link>
        <nav className="flex items-center gap-1 text-sm font-medium">
          {visible.map(({ label, href, also }) => {
            const active = [href, ...(also ?? [])].some((h) => pathname === h || pathname.startsWith(`${h}/`));
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "whitespace-nowrap rounded-md px-3 py-1.5 transition-colors",
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
        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />
          <UserMenu />
        </div>
      </Container>
    </header>
  );
}
