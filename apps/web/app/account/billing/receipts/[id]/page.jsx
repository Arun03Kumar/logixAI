"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ChevronLeft, Printer } from "lucide-react";
import { Button, Card, Container, EmptyState, Logo, Skeleton } from "@logixai/ui";
import AppHeader from "@/app/components/layout/AppHeader";
import RequireAuth from "@/app/components/layout/RequireAuth";
import { billingApi } from "@/app/lib/api/billing";
import { useApi } from "@/app/lib/api/useApi";
import { useSession } from "@/app/lib/auth/useSession";
import { formatDay, formatRupees } from "@/app/lib/billing/plan";

const METHOD = { razorpay: "Razorpay", mock: "Test checkout", coupon: "Coupon" };

function Row({ label, children, strong }) {
  return (
    <div className={strong ? "flex justify-between border-t border-border pt-2 font-semibold" : "flex justify-between"}>
      <span className={strong ? "" : "text-muted-foreground"}>{label}</span>
      <span className="tabular-nums">{children}</span>
    </div>
  );
}

function ReceiptView() {
  const { id } = useParams();
  const { user } = useSession();
  const receipt = useApi(() => billingApi.receipt(id), [id]);
  if (receipt.loading) return <Skeleton className="h-80" />;
  if (receipt.error) return <EmptyState title="Receipt not found" description={receipt.error.message} />;
  const r = receipt.data;
  return (
    <Card className="space-y-6 p-8 print:border-0 print:shadow-none">
      <div className="flex items-start justify-between gap-4">
        <Logo />
        <div className="text-right text-sm">
          <p className="font-semibold">Receipt</p>
          <p className="font-mono text-xs">{r.receiptNumber}</p>
          <p className="text-muted-foreground">{formatDay(r.paidAt)}</p>
        </div>
      </div>
      <div className="text-sm">
        <p className="text-muted-foreground">Billed to</p>
        <p className="font-medium">{user.name}</p>
        <p>{user.email}</p>
      </div>
      <div className="space-y-2 text-sm">
        <Row label={`${r.planName} (${r.days} days of Pro)`}>{formatRupees(r.listPaise)}</Row>
        {r.discountPaise ? <Row label={`Coupon ${r.couponCode}`}>−{formatRupees(r.discountPaise)}</Row> : null}
        <Row label="Total paid (includes GST)" strong>
          {formatRupees(r.totalPaise)}
        </Row>
      </div>
      <div className="space-y-1 text-xs text-muted-foreground">
        <p>
          Paid with: {METHOD[r.provider] ?? r.provider}
          {r.providerPaymentId ? ` · payment ${r.providerPaymentId}` : ""}
        </p>
        <p>LogixAI · info@logixai.com</p>
      </div>
    </Card>
  );
}

export default function ReceiptPage() {
  return (
    <>
      <div className="print:hidden">
        <AppHeader />
      </div>
      <main className="py-10">
        <Container size="md" className="space-y-4">
          <div className="flex justify-between print:hidden">
            <Button asChild variant="ghost" size="sm" className="-ml-2">
              <Link href="/account/billing">
                <ChevronLeft />
                Billing
              </Link>
            </Button>
            <Button variant="ghost" size="sm" onClick={() => window.print()}>
              <Printer />
              Print or save as PDF
            </Button>
          </div>
          <RequireAuth>
            <ReceiptView />
          </RequireAuth>
        </Container>
      </main>
    </>
  );
}
