"use client";
import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Receipt, Sparkles } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  Container,
  EmptyState,
  PageHeader,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  cn,
} from "@logixai/ui";
import AppHeader from "@/app/components/layout/AppHeader";
import RequireAuth from "@/app/components/layout/RequireAuth";
import { billingApi } from "@/app/lib/api/billing";
import { useApi } from "@/app/lib/api/useApi";
import { useSession } from "@/app/lib/auth/useSession";
import { formatDay, formatRupees, isPro } from "@/app/lib/billing/plan";

function PlanCard() {
  const { user } = useSession();
  // Read the clock once per visit, not on every render.
  const [now] = useState(() => Date.now());
  const pro = isPro(user, now);
  const daysLeft = pro ? Math.ceil((new Date(user.plan.until).getTime() - now) / 86_400_000) : 0;
  return (
    <Card className="flex flex-wrap items-center gap-4 p-5">
      <div className="grid size-10 place-items-center rounded-full bg-primary-soft">
        <Sparkles className="size-5 text-primary" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{pro ? "Pro" : "Free plan"}</p>
        <p className="text-sm text-muted-foreground">
          {pro
            ? `Until ${formatDay(user.plan.until)} (${daysLeft} ${daysLeft === 1 ? "day" : "days"} left)${user.plan.source === "institution" ? ", through your institution" : ""}.`
            : "Pro problems and unlimited code runs are part of Pro."}
        </p>
      </div>
      {pro && user.plan.source === "institution" ? null : (
        <Button asChild variant={pro ? "ghost" : "primary"} size="sm">
          <Link href="/pricing">{pro ? "Extend" : "See plans"}</Link>
        </Button>
      )}
    </Card>
  );
}

function History() {
  const highlight = useSearchParams().get("receipt");
  const overview = useApi(() => billingApi.overview(), []);
  if (overview.loading) return <Skeleton className="h-40" />;
  if (overview.error) return <EmptyState title="Billing isn't reachable" description={overview.error.message} />;
  const { payments, trialUsedAt } = overview.data;
  return (
    <Card className="overflow-hidden">
      <div className="px-5 py-4">
        <h2 className="font-semibold">Payments</h2>
        {trialUsedAt ? <p className="text-xs text-muted-foreground">Free trial used on {formatDay(trialUsedAt)}.</p> : null}
      </div>
      {payments.length ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Plan</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Receipt</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {payments.map((p) => (
              <TableRow key={p.id} className={cn(p.id === highlight && "bg-success-soft")}>
                <TableCell className="whitespace-nowrap">{formatDay(p.paidAt)}</TableCell>
                <TableCell>
                  {p.planName}
                  {p.couponCode ? <Badge tone="outline" className="ml-2">{p.couponCode}</Badge> : null}
                </TableCell>
                <TableCell className="tabular-nums">{p.status === "free" ? "Free (coupon)" : formatRupees(p.totalPaise)}</TableCell>
                <TableCell>
                  <Link href={`/account/billing/receipts/${p.id}`} className="font-mono text-xs text-primary underline underline-offset-2">
                    {p.receiptNumber}
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <EmptyState icon={<Receipt />} title="No payments yet" description="Receipts for Pro passes you buy appear here." />
      )}
    </Card>
  );
}

export default function BillingPage() {
  return (
    <>
      <AppHeader />
      <main className="py-10">
        <Container size="md" className="space-y-6">
          <PageHeader title="Plan and billing" />
          <RequireAuth>
            <PlanCard />
            <Suspense fallback={<Skeleton className="h-40" />}>
              <History />
            </Suspense>
          </RequireAuth>
        </Container>
      </main>
    </>
  );
}
