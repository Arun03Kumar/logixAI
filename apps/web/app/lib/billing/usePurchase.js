"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { billingApi } from "@/app/lib/api/billing";
import { refreshSession } from "@/app/lib/auth/session";
import { payWithRazorpay } from "./razorpay";

/**
 * Buying Pro: create the order on the server, take payment (Razorpay, or the
 * local mock dialog in development), confirm it on the server, then refresh
 * the session so the new plan applies immediately.
 */
export function usePurchase() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  /** Development only: the order waiting in the mock checkout dialog. */
  const [mockSession, setMockSession] = useState(null);

  const finish = async (payment) => {
    await refreshSession();
    toast.success(payment.totalPaise ? "Payment received — you're on Pro." : "Coupon applied — you're on Pro.");
    router.push(`/account/billing?receipt=${encodeURIComponent(payment.id)}`);
  };

  const buy = async (planId, couponCode) => {
    setBusy(true);
    try {
      const result = await billingApi.checkout(planId, couponCode || undefined);
      if (result.kind === "granted") return await finish(result.payment);
      const { session } = result;
      if (session.provider === "mock") {
        setMockSession(session);
        return;
      }
      const paid = await payWithRazorpay(session);
      const payment = await billingApi.verify(session.orderId, paid.providerPaymentId, paid.signature);
      await finish(payment);
    } catch (err) {
      if (!err.cancelled) toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const confirmMock = async () => {
    if (!mockSession) return;
    setBusy(true);
    try {
      const payment = await billingApi.devPay(mockSession.orderId);
      setMockSession(null);
      await finish(payment);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  return { buy, busy, mockSession, confirmMock, cancelMock: () => setMockSession(null) };
}
