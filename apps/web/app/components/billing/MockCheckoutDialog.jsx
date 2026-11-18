"use client";
import { useEffect, useRef } from "react";
import { FlaskConical } from "lucide-react";
import { Button } from "@logixai/ui";
import { formatRupees } from "@/app/lib/billing/plan";

/**
 * Development stand-in for Razorpay Checkout, shown when billing-service runs
 * without Razorpay keys. Nothing is charged; it only exists so the purchase
 * flow can be tried locally.
 */
export default function MockCheckoutDialog({ session, busy, onPay, onCancel }) {
  const ref = useRef(null);
  useEffect(() => {
    const dialog = ref.current;
    if (session && dialog && !dialog.open) dialog.showModal();
    if (!session && dialog?.open) dialog.close();
  }, [session]);

  return (
    <dialog
      ref={ref}
      onClose={onCancel}
      className="w-[min(92vw,420px)] rounded-xl border border-border bg-card p-0 text-card-foreground backdrop:bg-black/50"
    >
      {session ? (
        <div className="space-y-4 p-6">
          <div className="flex items-center gap-2 text-sm font-medium text-warning">
            <FlaskConical className="size-4" />
            Test checkout — no money moves
          </div>
          <div>
            <p className="text-lg font-semibold">{session.description}</p>
            <p className="text-sm text-muted-foreground">
              Billing has no Razorpay keys, so this stands in for the payment window. Add Razorpay test keys to try the real one.
            </p>
          </div>
          <div className="rounded-lg bg-muted p-3 text-sm">
            <div className="flex justify-between">
              <span>Price</span>
              <span className="tabular-nums">{formatRupees(session.quote.listPaise)}</span>
            </div>
            {session.quote.discountPaise ? (
              <div className="flex justify-between text-success">
                <span>Coupon {session.quote.couponCode}</span>
                <span className="tabular-nums">−{formatRupees(session.quote.discountPaise)}</span>
              </div>
            ) : null}
            <div className="mt-1 flex justify-between border-t border-border pt-1 font-semibold">
              <span>Total</span>
              <span className="tabular-nums">{formatRupees(session.quote.totalPaise)}</span>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onCancel} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" onClick={onPay} disabled={busy}>
              {busy ? "Paying…" : `Pay ${formatRupees(session.quote.totalPaise)} (test)`}
            </Button>
          </div>
        </div>
      ) : null}
    </dialog>
  );
}
