"use client";

import { useState } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import { Button, Container, Logo, ThemeToggle } from "@logixai/ui";

const LINKS = [
  { label: "Platform", href: "/#platform" },
  { label: "About", href: "/#about" },
  { label: "Services", href: "/#services" },
  { label: "Team", href: "/#team" },
  { label: "Practice", href: "/problems" },
];

/** Header for marketing pages. */
export default function SiteHeader() {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/75">
      <Container size="xl" className="flex h-16 items-center justify-between gap-6">
        <Link href="/" aria-label="LogixAI home">
          <Logo />
        </Link>

        <nav className="hidden items-center gap-7 text-sm font-medium text-muted-foreground md:flex">
          {LINKS.map(({ label, href }) => (
            <Link
              key={label}
              href={href}
              className="transition-colors hover:text-foreground"
            >
              {label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-2 md:flex">
          <ThemeToggle />
          <Button asChild variant="primary" size="sm">
            <Link href="/problems">Start practicing</Link>
          </Button>
        </div>

        <button
          type="button"
          className="grid size-9 place-items-center rounded-md text-foreground hover:bg-accent md:hidden"
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </Container>

      {open ? (
        <div className="border-t border-border bg-background md:hidden">
          <Container className="flex flex-col gap-1 py-3">
            {LINKS.map(({ label, href }) => (
              <Link
                key={label}
                href={href}
                onClick={() => setOpen(false)}
                className="rounded-md px-2 py-2 text-sm font-medium text-foreground hover:bg-accent"
              >
                {label}
              </Link>
            ))}
            <div className="mt-2 flex items-center justify-between">
              <ThemeToggle />
              <Button asChild variant="primary" size="sm">
                <Link href="/problems" onClick={() => setOpen(false)}>
                  Start practicing
                </Link>
              </Button>
            </div>
          </Container>
        </div>
      ) : null}
    </header>
  );
}
