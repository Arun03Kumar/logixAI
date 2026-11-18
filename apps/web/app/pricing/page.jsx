"use client";
import { useState } from "react";
import Link from "next/link";
import toast from "react-hot-toast";
import { Building2, Check, Sparkles } from "lucide-react";
import { Badge, Button, Card, Container, Input, PageHeader, Skeleton, cn } from "@logixai/ui";
import AppHeader from "@/app/components/layout/AppHeader";
import MockCheckoutDialog from "@/app/components/billing/MockCheckoutDialog";
import { billingApi } from "@/app/lib/api/billing";
import { useApi } from "@/app/lib/api/useApi";
import { refreshSession } from "@/app/lib/auth/session";
import { useSession } from "@/app/lib/auth/useSession";
import { formatDay, formatRupees, isPro } from "@/app/lib/billing/plan";
import { usePurchase } from "@/app/lib/billing/usePurchase";

const FREE = [
  "Every lesson, and all free practice problems",
  "Interactive labs",
  "Progress, streaks, reviews and the skill map",
  "30 code runs a day",
];
const PRO = [
  "Everything in Free",
  "Pro problems: the harder from-scratch, debugging and interview items",
  "Unlimited code runs",
  "Every new Pro track as it's released",
];
const INSTITUTION = [
  "Pro for every student and instructor",
  "Exams with proctoring signals and auto-grading",
  "Assign ML Arena tracks to batches",
  "Batch reports by student and topic",
];

function Feature({ children }) {
  return (
    <li className="flex gap-2 text-sm">
      <Check className="mt-0.5 size-4 shrink-0 text-success" />
      <span>{children}</span>
    </li>
  );
}

export default function PricingPage() {
  const { status, user } = useSession();
  const signedIn = status === "authenticated";
  const pro = isPro(user);
  const plans = useApi(() => billingApi.plans(), []);
  const overview = useApi(() => billingApi.overview(), [status], { enabled: signedIn });
  const [planId, setPlanId] = useState("pro_year");
  const [coupon, setCoupon] = useState("");
  const [quote, setQuote] = useState(null);
  const [checking, setChecking] = useState(false);
  const [trialBusy, setTrialBusy] = useState(false);
  const purchase = usePurchase();

  const options = plans.data?.options ?? [];
  const selected = options.find((p) => p.id === planId);
  const shownQuote = quote?.planId === planId ? quote : null;

  const applyCoupon = async (e) => {
    e.preventDefault();
    if (!coupon.trim()) return;
    setChecking(true);
    try {
      setQuote(await billingApi.quote(planId, coupon.trim()));
    } catch (err) {
      setQuote(null);
      toast.error(err.message);
    } finally {
      setChecking(false);
    }
  };

  const startTrial = async () => {
    setTrialBusy(true);
    try {
      await billingApi.startTrial();
      await refreshSession();
      overview.reload();
      toast.success(`Your ${plans.data?.trialDays ?? 7}-day Pro trial has started.`);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setTrialBusy(false);
    }
  };

  return (
    <>
      <AppHeader />
      <main className="py-10">
        <Container size="lg" className="space-y-8">
          <PageHeader
            title="Plans"
            description="Practise free for as long as you like. Pro unlocks the harder problems and removes the daily limit. Prices include GST; Pro passes don't renew automatically."
          />

          {pro ? (
            <p className="rounded-lg bg-success-soft px-4 py-3 text-sm">
              You&apos;re on Pro until <span className="font-semibold">{formatDay(user.plan.until)}</span>
              {user.plan.source === "institution" ? " through your institution." : ". Buying again adds to the end of your pass."}
            </p>
          ) : null}

          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="flex flex-col gap-4 p-6">
              <div>
                <h2 className="font-semibold">Free</h2>
                <p className="mt-1 text-3xl font-semibold">₹0</p>
              </div>
              <ul className="space-y-2">
                {FREE.map((f) => (
                  <Feature key={f}>{f}</Feature>
                ))}
              </ul>
              <Button asChild variant="ghost" className="mt-auto">
                <Link href="/arena">Start practising</Link>
              </Button>
            </Card>

            <Card className="flex flex-col gap-4 border-primary p-6">
              <div className="flex items-center justify-between">
                <h2 className="flex items-center gap-2 font-semibold">
                  <Sparkles className="size-4 text-primary" />
                  Pro
                </h2>
                {selected?.badge ? <Badge tone="brand">{selected.badge}</Badge> : null}
              </div>
              {plans.loading ? (
                <Skeleton className="h-16" />
              ) : plans.error ? (
                <p className="text-sm text-danger">Prices are unavailable right now. Try again in a moment.</p>
              ) : (
                <>
                  <div className="flex rounded-lg bg-muted p-1 text-sm" role="radiogroup" aria-label="Billing period">
                    {options.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        role="radio"
                        aria-checked={planId === p.id}
                        onClick={() => setPlanId(p.id)}
                        className={cn(
                          "flex-1 rounded-md px-3 py-1.5 transition-colors",
                          planId === p.id ? "bg-card font-medium shadow-sm" : "text-muted-foreground",
                        )}
                      >
                        {p.days >= 365 ? "12 months" : "1 month"}
                      </button>
                    ))}
                  </div>
                  <div>
                    {shownQuote && shownQuote.discountPaise ? (
                      <p className="text-sm text-muted-foreground line-through">{formatRupees(shownQuote.listPaise)}</p>
                    ) : null}
                    <p className="text-3xl font-semibold tabular-nums">
                      {formatRupees(shownQuote ? shownQuote.totalPaise : selected.pricePaise)}
                      <span className="ml-1 text-sm font-normal text-muted-foreground">
                        {selected.days >= 365 ? `for 12 months (${formatRupees(Math.round(selected.pricePaise / 12))}/month)` : "for 1 month"}
                      </span>
                    </p>
                  </div>
                </>
              )}
              <ul className="space-y-2">
                {PRO.map((f) => (
                  <Feature key={f}>{f}</Feature>
                ))}
              </ul>
              <div className="mt-auto space-y-3">
                {signedIn ? (
                  <form onSubmit={applyCoupon} className="flex gap-2">
                    <Input
                      value={coupon}
                      onChange={(e) => setCoupon(e.target.value.toUpperCase())}
                      placeholder="Coupon code"
                      aria-label="Coupon code"
                      className="font-mono"
                      maxLength={30}
                    />
                    <Button type="submit" variant="ghost" disabled={!coupon.trim() || checking}>
                      {checking ? "Checking…" : "Apply"}
                    </Button>
                  </form>
                ) : null}
                {signedIn ? (
                  <Button
                    variant="primary"
                    className="w-full"
                    disabled={!selected || purchase.busy}
                    onClick={() => purchase.buy(planId, shownQuote?.couponCode)}
                  >
                    {purchase.busy ? "Opening checkout…" : pro ? "Extend Pro" : "Get Pro"}
                  </Button>
                ) : (
                  <Button asChild variant="primary" className="w-full">
                    <Link href="/login?next=/pricing">Sign in to get Pro</Link>
                  </Button>
                )}
                {signedIn && !pro && overview.data?.trialAvailable ? (
                  <Button variant="ghost" className="w-full" onClick={startTrial} disabled={trialBusy}>
                    {trialBusy ? "Starting…" : `Try Pro free for ${plans.data?.trialDays ?? 7} days`}
                  </Button>
                ) : null}
              </div>
            </Card>

            <Card className="flex flex-col gap-4 p-6">
              <div>
                <h2 className="flex items-center gap-2 font-semibold">
                  <Building2 className="size-4 text-muted-foreground" />
                  Schools and colleges
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">One licence for the whole institution, priced by students.</p>
              </div>
              <ul className="space-y-2">
                {INSTITUTION.map((f) => (
                  <Feature key={f}>{f}</Feature>
                ))}
              </ul>
              <Button asChild variant="ghost" className="mt-auto">
                <a href="mailto:info@logixai.com?subject=LogixAI%20for%20our%20institution">Talk to us</a>
              </Button>
            </Card>
          </div>

          <p className="text-xs text-muted-foreground">
            Payments are processed by Razorpay (UPI, cards, netbanking). A Pro pass starts when you pay and adds to any time you
            already have; it doesn&apos;t renew on its own.
          </p>
        </Container>
      </main>
      <MockCheckoutDialog
        session={purchase.mockSession}
        busy={purchase.busy}
        onPay={purchase.confirmMock}
        onCancel={purchase.cancelMock}
      />
    </>
  );
}
