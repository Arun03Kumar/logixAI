"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Building2, CreditCard, KeyRound, LogOut, ShieldCheck, Sparkles } from "lucide-react";
import { Avatar, Badge, Button, Skeleton } from "@logixai/ui";
import { signOut } from "@/app/lib/auth/session";
import { useSession } from "@/app/lib/auth/useSession";
import { isPro } from "@/app/lib/billing/plan";

/** Signed-in: avatar menu. Signed-out: "Sign in". Loading: placeholder. */
export default function UserMenu() {
  const { status, user } = useSession();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (!ref.current?.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (status === "loading") return <Skeleton className="size-8 rounded-full" />;

  if (status === "anonymous") {
    return (
      <Button asChild variant="ghost" size="sm">
        <Link href="/login">Sign in</Link>
      </Button>
    );
  }

  const handleSignOut = async () => {
    setOpen(false);
    await signOut();
    router.push("/");
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        onClick={() => setOpen((v) => !v)}
        className="rounded-full focus-visible:outline-2"
      >
        <Avatar name={user.name} />
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-2 w-64 overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-[0_8px_24px_rgb(0_0_0/0.08)]"
        >
          <div className="border-b border-border px-4 py-3">
            <div className="flex items-center gap-2">
              <p className="truncate text-sm font-semibold">{user.name}</p>
              {isPro(user) ? (
                <Badge tone="brand">
                  <Sparkles className="size-3" />
                  Pro
                </Badge>
              ) : null}
              {user.role === "admin" ? (
                <Badge tone="info">
                  <ShieldCheck className="size-3" />
                  Admin
                </Badge>
              ) : null}
            </div>
            <p className="truncate text-xs text-muted-foreground">{user.email || "Signs in with a roll number"}</p>
          </div>
          <div className="p-1">
            <Link
              role="menuitem"
              href="/institutions"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-accent"
            >
              <Building2 className="size-4 text-muted-foreground" />
              Institutions
            </Link>
            <Link
              role="menuitem"
              href="/account/billing"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-accent"
            >
              <CreditCard className="size-4 text-muted-foreground" />
              Plan and billing
            </Link>
            <Link
              role="menuitem"
              href="/account/password"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-accent"
            >
              <KeyRound className="size-4 text-muted-foreground" />
              Change password
            </Link>
            {user.role === "admin" ? (
              <Link
                role="menuitem"
                href="/admin/billing"
                onClick={() => setOpen(false)}
                className="flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-accent"
              >
                <ShieldCheck className="size-4 text-muted-foreground" />
                Billing admin
              </Link>
            ) : null}
            {user.role === "admin" ? (
              <Link
                role="menuitem"
                href="/admin/institutions"
                onClick={() => setOpen(false)}
                className="flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-accent"
              >
                <Building2 className="size-4 text-muted-foreground" />
                Institutions console
              </Link>
            ) : null}
            <button
              role="menuitem"
              type="button"
              onClick={handleSignOut}
              className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-accent"
            >
              <LogOut className="size-4 text-muted-foreground" />
              Sign out
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
