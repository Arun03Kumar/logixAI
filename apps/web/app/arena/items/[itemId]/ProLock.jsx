"use client";
import Link from "next/link";
import { Lock } from "lucide-react";
import { Button, Card } from "@logixai/ui";
import MathMarkdown from "@/app/components/MathMarkdown";

/** A Pro item for someone without Pro: the problem statement and a way in. */
export default function ProLock({ item, signedIn }) {
  return (
    <div className="space-y-6">
      <MathMarkdown>{item.prompt}</MathMarkdown>
      <Card className="flex flex-wrap items-center gap-4 border-primary p-5">
        <div className="grid size-10 place-items-center rounded-full bg-primary-soft">
          <Lock className="size-5 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-semibold">This is a Pro problem</p>
          <p className="text-sm text-muted-foreground">
            Pro unlocks the harder from-scratch, debugging and interview problems, and removes the daily limit on code runs.
          </p>
        </div>
        <Button asChild variant="primary">
          <Link href={signedIn ? "/pricing" : `/login?next=/arena/items/${item.id}`}>
            {signedIn ? "See Pro plans" : "Sign in"}
          </Link>
        </Button>
      </Card>
    </div>
  );
}
