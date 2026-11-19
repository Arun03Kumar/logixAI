"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Building2, ChevronRight, Copy, Plus, X } from "lucide-react";
import toast from "react-hot-toast";
import {
  Badge,
  Button,
  Card,
  Checkbox,
  Container,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
} from "@logixai/ui";
import AppHeader from "@/app/components/layout/AppHeader";
import RequireAuth from "@/app/components/layout/RequireAuth";
import FormError from "@/app/components/forms/FormError";
import { identityApi } from "@/app/lib/api/identity";
import { useApi } from "@/app/lib/api/useApi";
import {
  DEFAULT_FEATURES,
  FEATURES,
  STATUS_LABEL,
  STATUS_TONE,
  SUGGESTED_DEPARTMENTS,
  TYPE_LABEL,
  formatDate,
} from "@/app/institutions/labels";
import ContractFields, { contractFromForm, emptyContractForm } from "./ContractFields";

const splitEmails = (text) =>
  text
    .split(/[\s,;]+/)
    .map((e) => e.trim())
    .filter(Boolean);

function CreatedNotice({ result, onDone }) {
  const router = useRouter();
  const copy = (text) => navigator.clipboard?.writeText(text).then(() => toast.success("Copied."));
  return (
    <Card className="space-y-4 p-5">
      <div>
        <h2 className="text-base font-semibold">{result.institution.name} is set up</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {result.ownersAdded.length
            ? `${result.ownersAdded.join(", ")} ${result.ownersAdded.length === 1 ? "is" : "are"} now an owner. `
            : ""}
          {result.ownerInvites.length
            ? "These owners don't have an account yet. Send each one their code; it works once and lasts 30 days."
            : ""}
        </p>
      </div>
      {result.ownerInvites.length ? (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {result.ownerInvites.map((inv) => (
            <li key={inv.code} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
              <span className="min-w-0 truncate">{inv.email}</span>
              <span className="flex items-center gap-2">
                <code className="font-mono font-semibold">{inv.code}</code>
                <Button variant="ghost" size="icon-sm" aria-label={`Copy code for ${inv.email}`} onClick={() => copy(inv.code)}>
                  <Copy />
                </Button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex gap-2">
        <Button variant="primary" onClick={() => router.push(`/admin/institutions/${result.institution.id}`)}>
          Open in console
        </Button>
        <Button variant="ghost" onClick={onDone}>
          Done
        </Button>
      </div>
    </Card>
  );
}

function CreateForm({ onCancel, onCreated }) {
  const [form, setForm] = useState({
    name: "",
    type: "college",
    owners: "",
    departments: SUGGESTED_DEPARTMENTS.college.join("\n"),
    features: DEFAULT_FEATURES.college,
    withContract: false,
    contract: emptyContractForm(),
  });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [saving, setSaving] = useState(false);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const changeType = (type) =>
    setForm((f) => ({
      ...f,
      type,
      features: DEFAULT_FEATURES[type],
      // Only replace the department list if it's still the previous suggestion.
      departments:
        f.departments.trim() === SUGGESTED_DEPARTMENTS[f.type].join("\n") ? SUGGESTED_DEPARTMENTS[type].join("\n") : f.departments,
    }));

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setErrors({});
    setFormError(null);
    try {
      const result = await identityApi.admin.create({
        name: form.name,
        type: form.type,
        ownerEmails: splitEmails(form.owners),
        departments: form.departments
          .split("\n")
          .map((d) => d.trim())
          .filter(Boolean),
        features: form.features,
        ...(form.withContract ? { contract: contractFromForm(form.contract) } : {}),
      });
      onCreated(result);
    } catch (err) {
      setErrors(err.fieldErrors ?? {});
      setFormError(err.message);
      setSaving(false);
    }
  };

  return (
    <Card className="p-5">
      <h2 className="text-base font-semibold">New institution</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Owners with a LogixAI account are added straight away; the rest get a one-time owner code to share.
      </p>
      <form onSubmit={submit} className="mt-5 space-y-5">
        <FormError message={formError} />
        <div className="grid gap-4 sm:grid-cols-[1fr_220px]">
          <Field label="Name" htmlFor="ni-name" error={errors.name}>
            <Input id="ni-name" value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="Delhi Technological University" />
          </Field>
          <Field label="Type" htmlFor="ni-type">
            <Select value={form.type} onValueChange={changeType}>
              <SelectTrigger id="ni-type" className="w-full">
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
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Owner emails" htmlFor="ni-owners" hint="The head, principal or director. Up to 5, separated by commas or new lines." error={errors.ownerEmails}>
            <Textarea id="ni-owners" rows={4} value={form.owners} onChange={(e) => set({ owners: e.target.value })} placeholder="principal@school.edu.in" />
          </Field>
          <Field label="Departments" htmlFor="ni-depts" hint="One per line. Suggested for this type; edit freely." error={errors.departments}>
            <Textarea id="ni-depts" rows={4} value={form.departments} onChange={(e) => set({ departments: e.target.value })} />
          </Field>
        </div>

        <fieldset>
          <legend className="text-sm font-medium">Features</legend>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {FEATURES.map((f) => (
              <Checkbox
                key={f.key}
                label={f.soon ? `${f.label} (coming soon)` : f.label}
                description={f.description}
                checked={form.features[f.key]}
                onChange={(e) => set({ features: { ...form.features, [f.key]: e.target.checked } })}
              />
            ))}
          </div>
        </fieldset>

        <div className="space-y-3">
          <Checkbox
            label="Add a contract now"
            description="While a contract is active every member has Pro, and per-seat contracts cap the number of students."
            checked={form.withContract}
            onChange={(e) => set({ withContract: e.target.checked })}
          />
          {form.withContract ? (
            <ContractFields value={form.contract} onChange={(contract) => set({ contract })} errors={errors} idPrefix="ni" />
          ) : null}
        </div>

        <div className="flex gap-2">
          <Button type="submit" variant="primary" disabled={saving}>
            {saving ? <Spinner className="text-primary-foreground" /> : null}
            Create institution
          </Button>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}

function Console() {
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState(null);
  const [now] = useState(() => Date.now());
  const list = useApi(() => identityApi.admin.list(search), [search]);
  const rows = list.data ?? [];

  return (
    <div className="space-y-6">
      {created ? (
        <CreatedNotice result={created} onDone={() => setCreated(null)} />
      ) : creating ? (
        <CreateForm
          onCancel={() => setCreating(false)}
          onCreated={(result) => {
            setCreating(false);
            setCreated(result);
            list.reload();
          }}
        />
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              setSearch(query.trim());
            }}
          >
            <Input aria-label="Search institutions" placeholder="Search by name" value={query} onChange={(e) => setQuery(e.target.value)} className="w-64" />
            <Button type="submit" variant="outline">
              Search
            </Button>
            {search ? (
              <Button
                variant="ghost"
                size="icon"
                aria-label="Clear search"
                onClick={() => {
                  setQuery("");
                  setSearch("");
                }}
              >
                <X />
              </Button>
            ) : null}
          </form>
          <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
            <Plus />
            New institution
          </Button>
        </div>
      )}

      <Card className="overflow-hidden">
        {list.loading ? (
          <div className="space-y-3 p-5">
            <Skeleton className="h-5 w-1/3" />
            <Skeleton className="h-5 w-1/4" />
          </div>
        ) : list.error ? (
          <EmptyState title="Couldn't load institutions" description={list.error.message} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<Building2 />}
            title={search ? "No institutions match" : "No institutions yet"}
            description={search ? "Try another name." : "Set up the first one with New institution."}
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Institution</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Students</TableHead>
                <TableHead>Active (7 days)</TableHead>
                <TableHead>Contract ends</TableHead>
                <TableHead className="w-10">
                  <span className="sr-only">Open</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((inst) => {
                const members = inst.students + inst.staff;
                const ending = inst.contractEndsAt && new Date(inst.contractEndsAt) - now < 30 * 24 * 60 * 60 * 1000;
                return (
                  <TableRow key={inst.id}>
                    <TableCell>
                      <Link href={`/admin/institutions/${inst.id}`} className="font-medium hover:underline">
                        {inst.name}
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        {TYPE_LABEL[inst.type]}
                        {inst.ownerNames.length ? ` · ${inst.ownerNames.join(", ")}` : " · no owner yet"}
                      </p>
                    </TableCell>
                    <TableCell>
                      <Badge tone={STATUS_TONE[inst.status]}>{STATUS_LABEL[inst.status]}</Badge>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {inst.students}
                      {inst.seats ? <span className="text-muted-foreground"> / {inst.seats}</span> : null}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {inst.activeLast7Days}
                      {members ? ` of ${members}` : ""}
                    </TableCell>
                    <TableCell className={ending ? "whitespace-nowrap text-warning" : "whitespace-nowrap text-muted-foreground"}>
                      {formatDate(inst.contractEndsAt)}
                    </TableCell>
                    <TableCell>
                      <Button asChild variant="ghost" size="icon-sm" aria-label={`Open ${inst.name}`}>
                        <Link href={`/admin/institutions/${inst.id}`}>
                          <ChevronRight />
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}

export default function AdminInstitutionsPage() {
  return (
    <>
      <AppHeader />
      <main className="py-10">
        <Container size="xl" className="space-y-6">
          <PageHeader
            title="Institutions console"
            description="Set up institutions, switch features on, record contracts and help their admins."
          />
          <RequireAuth role="admin">
            <Console />
          </RequireAuth>
        </Container>
      </main>
    </>
  );
}
