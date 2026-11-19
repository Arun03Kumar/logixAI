"use client";
import { useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ShieldAlert } from "lucide-react";
import { Button, Container, EmptyState, Spinner } from "@logixai/ui";
import { useRequireAuth } from "@/app/lib/auth/useSession";

/**
 * Renders children only for signed-in users (redirects others to /login).
 * With `role="admin"`, also requires the platform admin role.
 */
export default function RequireAuth({ role, children }) {
  const { status, user } = useRequireAuth();
  const router = useRouter();
  const pathname = usePathname();
  // Temporary passwords (from an institution) are replaced before anything else.
  const mustChange = status === "authenticated" && user.mustChangePassword;
  useEffect(() => {
    if (mustChange) router.replace(`/account/password?next=${encodeURIComponent(pathname)}`);
  }, [mustChange, router, pathname]);

  if (status !== "authenticated" || mustChange) {
    return (
      <div className="grid min-h-[50vh] place-items-center">
        <Spinner className="size-5" />
      </div>
    );
  }

  if (role === "admin" && user.role !== "admin") {
    return (
      <Container className="py-16">
        <EmptyState
          icon={<ShieldAlert />}
          title="You don't have access to this page"
          description="This page is for LogixAI platform admins. Ask an admin if you need access."
          action={
            <Button asChild size="sm">
              <Link href="/problems">Back to practice</Link>
            </Button>
          }
        />
      </Container>
    );
  }

  return children;
}
