"use client";
import { useState } from "react";
import toast from "react-hot-toast";
import {
  Badge,
  Button,
  Card,
  Container,
  EmptyState,
  Input,
  PageHeader,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
} from "@logixai/ui";
import AppHeader from "@/app/components/layout/AppHeader";
import LoadMore from "@/app/components/LoadMore";
import RequireAuth from "@/app/components/layout/RequireAuth";
import { billingApi } from "@/app/lib/api/billing";
import { useApi } from "@/app/lib/api/useApi";
import { usePagedApi } from "@/app/lib/api/usePagedApi";
import { formatDay, formatRupees } from "@/app/lib/billing/plan";

function Field({ label, children, id }) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-xs font-medium text-muted-foreground">
        {label}
      </label>
      {children}
    </div>
  );
}

function Payments() {
  const list = usePagedApi((cursor) => billingApi.payments({ cursor }), []);
  if (list.loading) return <Skeleton className="h-40" />;
  if (list.error) return <EmptyState title="Billing isn't reachable" description={list.error.message} />;
  const { last30Days } = list.data;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Revenue, last 30 days</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{formatRupees(last30Days.revenuePaise)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Paid orders, last 30 days</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{last30Days.count}</p>
        </Card>
      </div>
      <Card className="overflow-hidden">
        {list.items.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Receipt</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>User id</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.items.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="whitespace-nowrap">{formatDay(p.paidAt)}</TableCell>
                  <TableCell className="font-mono text-xs">{p.receiptNumber}</TableCell>
                  <TableCell>
                    {p.planName}
                    {p.couponCode ? <Badge tone="outline" className="ml-2">{p.couponCode}</Badge> : null}
                  </TableCell>
                  <TableCell className="tabular-nums">{formatRupees(p.totalPaise)}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{p.userId}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <EmptyState title="No payments yet" />
        )}
        <LoadMore list={list} />
      </Card>
    </div>
  );
}

function Coupons() {
  const coupons = useApi(() => billingApi.coupons(), []);
  const [form, setForm] = useState({ code: "", kind: "percent", value: "", max: "", expires: "" });
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const create = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const value = Number(form.value);
      const created = await billingApi.createCoupon({
        code: form.code,
        percentOff: form.kind === "percent" ? value : null,
        amountOffPaise: form.kind === "amount" ? Math.round(value * 100) : null,
        maxRedemptions: form.max ? Number(form.max) : null,
        expiresAt: form.expires ? new Date(`${form.expires}T23:59:59`).toISOString() : null,
      });
      coupons.setData((rows) => [created, ...(rows ?? [])]);
      setForm({ code: "", kind: "percent", value: "", max: "", expires: "" });
      toast.success(`Coupon ${created.code} created.`);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const disable = async (c) => {
    if (!window.confirm(`Disable ${c.code}? It stops working at once.`)) return;
    try {
      const updated = await billingApi.disableCoupon(c.id);
      coupons.setData((rows) => rows.map((r) => (r.id === c.id ? updated : r)));
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <form onSubmit={create} className="flex flex-wrap items-end gap-3">
          <Field label="Code" id="c-code">
            <Input id="c-code" value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))} className="w-36 font-mono" required />
          </Field>
          <Field label="Discount" id="c-kind">
            <select id="c-kind" value={form.kind} onChange={set("kind")} className="h-9 rounded-md border border-input bg-card px-2 text-sm">
              <option value="percent">% off</option>
              <option value="amount">₹ off</option>
            </select>
          </Field>
          <Field label={form.kind === "percent" ? "Percent" : "Rupees"} id="c-value">
            <Input id="c-value" type="number" min="1" max={form.kind === "percent" ? 100 : undefined} value={form.value} onChange={set("value")} className="w-24" required />
          </Field>
          <Field label="Max uses (optional)" id="c-max">
            <Input id="c-max" type="number" min="1" value={form.max} onChange={set("max")} className="w-28" />
          </Field>
          <Field label="Expires (optional)" id="c-exp">
            <Input id="c-exp" type="date" value={form.expires} onChange={set("expires")} className="w-40" />
          </Field>
          <Button type="submit" variant="primary" disabled={saving}>
            Create coupon
          </Button>
        </form>
      </Card>
      <Card className="overflow-hidden">
        {coupons.loading ? (
          <Skeleton className="m-5 h-20" />
        ) : (coupons.data ?? []).length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Discount</TableHead>
                <TableHead>Used</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {coupons.data.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-mono">{c.code}</TableCell>
                  <TableCell>{c.percentOff !== null ? `${c.percentOff}%` : formatRupees(c.amountOffPaise)}</TableCell>
                  <TableCell className="tabular-nums">
                    {c.redemptions}
                    {c.maxRedemptions !== null ? ` / ${c.maxRedemptions}` : ""}
                  </TableCell>
                  <TableCell>{formatDay(c.expiresAt)}</TableCell>
                  <TableCell>{c.active ? <Badge tone="success">Active</Badge> : <Badge>Disabled</Badge>}</TableCell>
                  <TableCell className="text-right">
                    {c.active ? (
                      <Button variant="ghost" size="sm" onClick={() => disable(c)}>
                        Disable
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <EmptyState title="No coupons yet" />
        )}
      </Card>
    </div>
  );
}

function GrantPro() {
  const [form, setForm] = useState({ email: "", days: "30", note: "" });
  const [saving, setSaving] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await billingApi.grantPro({ email: form.email, days: Number(form.days), note: form.note });
      toast.success(`${res.email} has Pro until ${formatDay(res.proUntil)}.`);
      setForm({ email: "", days: "30", note: "" });
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Card className="space-y-3 p-5">
      <p className="text-sm text-muted-foreground">
        Complimentary Pro for support cases, partners or prizes. It adds to any Pro the person already has and is recorded in the audit log.
      </p>
      <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
        <Field label="Email" id="g-email">
          <Input id="g-email" type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} className="w-64" required />
        </Field>
        <Field label="Days" id="g-days">
          <Input id="g-days" type="number" min="1" max="3650" value={form.days} onChange={(e) => setForm((f) => ({ ...f, days: e.target.value }))} className="w-24" required />
        </Field>
        <Field label="Reason" id="g-note">
          <Input id="g-note" value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} className="w-64" minLength={3} required />
        </Field>
        <Button type="submit" variant="primary" disabled={saving}>
          Grant Pro
        </Button>
      </form>
    </Card>
  );
}

const TABS = [
  { value: "payments", label: "Payments" },
  { value: "coupons", label: "Coupons" },
  { value: "grant", label: "Grant Pro" },
];

export default function BillingAdminPage() {
  const [tab, setTab] = useState("payments");
  return (
    <>
      <AppHeader />
      <main className="py-10">
        <Container size="xl" className="space-y-6">
          <PageHeader title="Billing admin" description="Revenue, coupons and complimentary Pro. Institution contracts live in the institutions console." />
          <RequireAuth role="admin">
            <Tabs items={TABS} value={tab} onValueChange={setTab} aria-label="Billing admin sections" />
            <div className="mt-6">
              {tab === "payments" && <Payments />}
              {tab === "coupons" && <Coupons />}
              {tab === "grant" && <GrantPro />}
            </div>
          </RequireAuth>
        </Container>
      </main>
    </>
  );
}
