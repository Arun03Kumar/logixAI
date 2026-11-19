"use client";
import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import toast from "react-hot-toast";
import { AlertCircle, ChevronLeft, Copy, ExternalLink } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  Checkbox,
  Container,
  EmptyState,
  Field,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Spinner,
  Tabs,
} from "@logixai/ui";
import AppHeader from "@/app/components/layout/AppHeader";
import RequireAuth from "@/app/components/layout/RequireAuth";
import { identityApi } from "@/app/lib/api/identity";
import { useApi } from "@/app/lib/api/useApi";
import { formatRupees } from "@/app/lib/billing/plan";
import {
  FEATURES,
  ROLES,
  ROLE_LABEL,
  STATUS_LABEL,
  STATUS_TONE,
  TYPE_LABEL,
  formatDate,
} from "@/app/institutions/labels";
import ContractFields, { contractFromForm, contractToForm } from "../ContractFields";

function Stat({ label, value, hint }) {
  return (
    <Card className="p-4">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
    </Card>
  );
}

function Overview({ inst }) {
  const c = inst.contract;
  const live = c && new Date(c.endsAt) > new Date() && inst.status === "active";
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Students" value={inst.students} hint={inst.seats ? `of ${inst.seats} seats` : "no seat limit"} />
        <Stat label="Staff" value={inst.staff} />
        <Stat label="Active in 7 days" value={inst.activeLast7Days} />
        <Stat label="Departments / batches" value={`${inst.departments} / ${inst.batches}`} />
      </div>
      <Card className="p-5">
        <h2 className="text-sm font-semibold">People by role</h2>
        <dl className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-6">
          {ROLES.map((r) => (
            <div key={r}>
              <dt className="text-xs text-muted-foreground">{ROLE_LABEL[r]}</dt>
              <dd className="font-medium tabular-nums">{inst.roleCounts[r] ?? 0}</dd>
            </div>
          ))}
        </dl>
      </Card>
      <Card className="p-5 text-sm">
        <h2 className="font-semibold">Contract</h2>
        {c ? (
          <p className="mt-2 text-muted-foreground">
            {c.model === "per_seat" ? `${c.seats} seats at ${formatRupees(c.pricePaise)} each` : `Flat ${formatRupees(c.pricePaise)}`}
            {c.model === "flat" ? (c.seats ? `, up to ${c.seats} students` : ", no student limit") : ""} · {formatDate(c.startsAt)} to{" "}
            {formatDate(c.endsAt)} <Badge tone={live ? "success" : "neutral"}>{live ? "Active" : "Not active"}</Badge>
          </p>
        ) : (
          <p className="mt-2 text-muted-foreground">No contract. Members don&apos;t get Pro and there&apos;s no seat limit.</p>
        )}
      </Card>
    </div>
  );
}

function Settings({ inst, onSaved }) {
  const [form, setForm] = useState({ name: inst.name, type: inst.type });
  const [domains, setDomains] = useState((inst.emailDomains ?? []).join(", "));
  const [saving, setSaving] = useState(false);
  const domainList = domains.split(/[s,]+/).map((d) => d.trim().toLowerCase()).filter(Boolean);
  const domainsChanged = domainList.join(",") !== (inst.emailDomains ?? []).join(",");

  const save = async (patch, message) => {
    setSaving(true);
    try {
      onSaved(await identityApi.admin.update(inst.id, patch));
      toast.success(message);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const setStatus = (status) => {
    const warn = {
      suspended: `Suspend ${inst.name}? Members lose access and Pro until you reactivate it.`,
      archived: `Archive ${inst.name}? Members lose access. You can reactivate it later.`,
      active: `Reactivate ${inst.name}?`,
    }[status];
    if (window.confirm(warn)) save({ status }, `${inst.name} is now ${STATUS_LABEL[status].toLowerCase()}.`);
  };

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <h2 className="text-sm font-semibold">Name and type</h2>
        <form
          className="mt-4 grid max-w-2xl gap-4 sm:grid-cols-[1fr_200px]"
          onSubmit={(e) => {
            e.preventDefault();
            save(form, "Saved.");
          }}
        >
          <Field label="Name" htmlFor="s-name">
            <Input id="s-name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </Field>
          <Field label="Type" htmlFor="s-type">
            <Select value={form.type} onValueChange={(type) => setForm((f) => ({ ...f, type }))}>
              <SelectTrigger id="s-type" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(TYPE_LABEL).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <div>
            <Button type="submit" disabled={saving || (form.name === inst.name && form.type === inst.type)}>
              Save
            </Button>
          </div>
        </form>
      </Card>
      <Card className="p-5">
        <h2 className="text-sm font-semibold">Email domains</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          People signed in with an address at these domains can ask to join; staff approve them in the Requests tab.
          Needs the Email domain joining feature{inst.features.domainJoin ? "" : " (off now)"}. Webmail domains like
          gmail.com aren&apos;t allowed.
        </p>
        <form
          className="mt-4 flex max-w-2xl flex-col gap-3 sm:flex-row sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            save({ emailDomains: domainList }, "Email domains saved.");
          }}
        >
          <Field label="Domains" htmlFor="s-domains" hint="Separate with commas, e.g. abc.edu.in, students.abc.edu.in" className="flex-1">
            <Input id="s-domains" value={domains} onChange={(e) => setDomains(e.target.value)} placeholder="abc.edu.in" />
          </Field>
          <Button type="submit" disabled={saving || !domainsChanged}>
            Save
          </Button>
        </form>
      </Card>
      <Card className="p-5">
        <h2 className="text-sm font-semibold">Status</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Suspended and archived institutions are closed to their members. You can still open them for support.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {["active", "suspended", "archived"]
            .filter((s) => s !== inst.status)
            .map((s) => (
              <Button key={s} variant={s === "active" ? "primary" : "outline"} disabled={saving} onClick={() => setStatus(s)}>
                {s === "active" ? "Reactivate" : s === "suspended" ? "Suspend" : "Archive"}
              </Button>
            ))}
        </div>
      </Card>
    </div>
  );
}

function Features({ inst, onSaved }) {
  const [flags, setFlags] = useState(inst.features);
  const [saving, setSaving] = useState(false);
  const changed = FEATURES.some((f) => flags[f.key] !== inst.features[f.key]);
  const save = async () => {
    setSaving(true);
    try {
      onSaved(await identityApi.admin.setFeatures(inst.id, flags));
      toast.success("Features updated.");
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Card className="p-5">
      <p className="text-sm text-muted-foreground">
        Switch on what this institution bought. Changes reach members within a minute.
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {FEATURES.map((f) => (
          <Checkbox
            key={f.key}
            label={f.soon ? `${f.label} (coming soon)` : f.label}
            description={f.description}
            checked={flags[f.key]}
            onChange={(e) => setFlags((x) => ({ ...x, [f.key]: e.target.checked }))}
          />
        ))}
      </div>
      <Button className="mt-5" variant="primary" disabled={!changed || saving} onClick={save}>
        {saving ? <Spinner className="text-primary-foreground" /> : null}
        Save features
      </Button>
    </Card>
  );
}

function Contract({ inst, onSaved }) {
  const [form, setForm] = useState(() => contractToForm(inst.contract));
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const save = async (contract) => {
    setSaving(true);
    setErrors({});
    try {
      onSaved(await identityApi.admin.setContract(inst.id, contract));
      toast.success(contract ? "Contract saved." : "Contract removed.");
    } catch (err) {
      setErrors(err.fieldErrors ?? {});
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Card className="space-y-4 p-5">
      <p className="text-sm text-muted-foreground">
        While the contract runs, every member has Pro. Per-seat contracts, and flat bands with a limit, stop new students
        joining once the seats are used.
      </p>
      <ContractFields value={form} onChange={setForm} errors={errors} idPrefix="ct" />
      <div className="flex gap-2">
        <Button variant="primary" disabled={saving} onClick={() => save(contractFromForm(form))}>
          {saving ? <Spinner className="text-primary-foreground" /> : null}
          Save contract
        </Button>
        {inst.contract ? (
          <Button
            variant="ghost"
            className="text-danger"
            disabled={saving}
            onClick={() => window.confirm(`Remove ${inst.name}'s contract? Members lose Pro.`) && save(null)}
          >
            Remove contract
          </Button>
        ) : null}
      </div>
    </Card>
  );
}

function Owners({ inst, onChanged }) {
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const copy = (text) => navigator.clipboard?.writeText(text).then(() => toast.success("Copied."));
  const add = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await identityApi.admin.addOwner(inst.id, email);
      toast.success(res.added ? `${email} is now an owner.` : `Owner code for ${email}: ${res.invite.code}`);
      setEmail("");
      onChanged();
    } catch (err) {
      toast.error(err.fieldErrors?.email ?? err.message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="space-y-4">
      <Card className="p-5">
        <h2 className="text-sm font-semibold">Owners</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {inst.ownerNames.length ? inst.ownerNames.join(", ") : "No owner has joined yet."} Owners manage everything else
          (admins, departments, batches, invites) from the institution page.
        </p>
        <form onSubmit={add} className="mt-4 flex max-w-md gap-2">
          <Input type="email" aria-label="Owner email" placeholder="head@institution.edu" value={email} onChange={(e) => setEmail(e.target.value)} />
          <Button type="submit" disabled={saving || !email.trim()}>
            Add owner
          </Button>
        </form>
      </Card>
      <Card className="p-5">
        <h2 className="text-sm font-semibold">Owner codes waiting to be used</h2>
        {inst.pendingOwnerInvites.length ? (
          <ul className="mt-3 divide-y divide-border rounded-lg border border-border">
            {inst.pendingOwnerInvites.map((inv) => (
              <li key={inv.code} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                <span className="min-w-0 truncate">
                  {inv.email} <span className="text-muted-foreground">· expires {formatDate(inv.expiresAt)}</span>
                </span>
                <span className="flex items-center gap-2">
                  <code className="font-mono font-semibold">{inv.code}</code>
                  <Button variant="ghost" size="icon-sm" aria-label={`Copy code for ${inv.email}`} onClick={() => copy(inv.code)}>
                    <Copy />
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">None.</p>
        )}
      </Card>
    </div>
  );
}

const TABS = [
  { value: "overview", label: "Overview" },
  { value: "settings", label: "Settings" },
  { value: "features", label: "Features" },
  { value: "contract", label: "Contract" },
  { value: "owners", label: "Owners" },
];

function Detail() {
  const { id } = useParams();
  const detail = useApi(() => identityApi.admin.get(id), [id]);
  const [tab, setTab] = useState("overview");

  if (detail.loading && !detail.data) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-7 w-1/3" />
        <Skeleton className="h-4 w-1/5" />
      </div>
    );
  }
  if (detail.error && !detail.data) {
    return <EmptyState icon={<AlertCircle />} title="Couldn't load this institution" description={detail.error.message} />;
  }
  const inst = detail.data;
  const saved = (next) => detail.setData(next);

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold">{inst.name}</h1>
            <Badge tone={STATUS_TONE[inst.status]}>{STATUS_LABEL[inst.status]}</Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {TYPE_LABEL[inst.type]} · since {formatDate(inst.createdAt)}
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href={`/institutions/${inst.id}`}>
            <ExternalLink />
            Open as support
          </Link>
        </Button>
      </div>
      <div className="mt-8">
        <Tabs items={TABS} value={tab} onValueChange={setTab} aria-label="Institution console sections" />
        <div className="mt-6">
          {/* Keyed by the record so forms reset after a save. */}
          {tab === "overview" && <Overview inst={inst} />}
          {tab === "settings" && (
            <Settings key={`${inst.name}|${inst.type}|${inst.status}|${(inst.emailDomains ?? []).join(",")}`} inst={inst} onSaved={saved} />
          )}
          {tab === "features" && <Features key={JSON.stringify(inst.features)} inst={inst} onSaved={saved} />}
          {tab === "contract" && <Contract key={inst.contract?.updatedAt ?? "none"} inst={inst} onSaved={saved} />}
          {tab === "owners" && <Owners inst={inst} onChanged={detail.reload} />}
        </div>
      </div>
    </>
  );
}

export default function AdminInstitutionPage() {
  return (
    <>
      <AppHeader />
      <main className="py-10">
        <Container size="xl">
          <Button asChild variant="ghost" size="sm" className="-ml-2 mb-4">
            <Link href="/admin/institutions">
              <ChevronLeft />
              Institutions console
            </Link>
          </Button>
          <RequireAuth role="admin">
            <Detail />
          </RequireAuth>
        </Container>
      </main>
    </>
  );
}
