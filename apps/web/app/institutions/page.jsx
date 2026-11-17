"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Building2, ChevronRight, Plus } from "lucide-react";
import {
  Badge,
  Button,
  Card,
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
} from "@logixai/ui";
import AppHeader from "@/app/components/layout/AppHeader";
import RequireAuth from "@/app/components/layout/RequireAuth";
import FormError from "@/app/components/forms/FormError";
import { identityApi } from "@/app/lib/api/identity";
import { useApi } from "@/app/lib/api/useApi";
import { ROLE_LABEL, ROLE_TONE, TYPE_LABEL } from "./labels";

function JoinWithCode() {
  const router = useRouter();
  const [code, setCode] = useState("");
  return (
    <form
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (code.trim()) router.push(`/join/${encodeURIComponent(code.trim())}`);
      }}
    >
      <Input
        aria-label="Invite code"
        placeholder="Invite code, e.g. K7QM-2XPA"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        className="font-mono uppercase placeholder:normal-case"
      />
      <Button type="submit" disabled={!code.trim()}>
        Join
      </Button>
    </form>
  );
}

function CreateInstitutionForm({ onCancel }) {
  const router = useRouter();
  const [form, setForm] = useState({ name: "", type: "college" });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      const created = await identityApi.createInstitution(form);
      router.push(`/institutions/${created.institution.id}`);
    } catch (err) {
      setErrors(err.fieldErrors ?? {});
      setFormError(err.message);
      setSaving(false);
    }
  };

  return (
    <Card className="p-5">
      <h2 className="text-base font-semibold">Set up an institution</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        You&apos;ll be its owner. Next you can create batches and invite
        instructors and students.
      </p>
      <form onSubmit={submit} className="mt-5 grid gap-4 sm:grid-cols-[1fr_200px]">
        <div className="sm:col-span-2">
          <FormError message={formError} />
        </div>
        <Field label="Name" htmlFor="inst-name" error={errors.name}>
          <Input
            id="inst-name"
            placeholder="Delhi Public School, R. K. Puram"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            aria-invalid={Boolean(errors.name)}
          />
        </Field>
        <Field label="Type" htmlFor="inst-type">
          <Select value={form.type} onValueChange={(type) => setForm((f) => ({ ...f, type }))}>
            <SelectTrigger id="inst-type" className="w-full">
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
        <div className="flex gap-2 sm:col-span-2">
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

function InstitutionsList() {
  const [creating, setCreating] = useState(false);
  const { data, loading, error } = useApi(() => identityApi.me(), []);
  const memberships = data?.memberships ?? [];

  return (
    <Container className="py-10">
      <PageHeader
        title="Institutions"
        description="Schools and colleges you belong to. Tests and courses from your institution appear here."
        actions={
          !creating ? (
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus />
              Create institution
            </Button>
          ) : null
        }
      />

      <div className="space-y-6">
        {creating ? <CreateInstitutionForm onCancel={() => setCreating(false)} /> : null}

        <Card className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold">Have an invite code?</h2>
            <p className="text-sm text-muted-foreground">
              Your teacher or institution admin can give you one.
            </p>
          </div>
          <div className="sm:w-80">
            <JoinWithCode />
          </div>
        </Card>

        <Card className="overflow-hidden">
          {loading ? (
            <div className="space-y-3 p-5">
              <Skeleton className="h-5 w-1/3" />
              <Skeleton className="h-5 w-1/4" />
            </div>
          ) : error ? (
            <EmptyState title="Couldn't load your institutions" description={error.message} />
          ) : memberships.length === 0 ? (
            <EmptyState
              icon={<Building2 />}
              title="You're not part of an institution yet"
              description="Join with an invite code, or set up your school or college to invite your students."
            />
          ) : (
            <ul className="divide-y divide-border">
              {memberships.map(({ institution, role }) => (
                <li key={institution.id}>
                  <Link
                    href={`/institutions/${institution.id}`}
                    className="group flex items-center gap-4 px-5 py-4 transition-colors hover:bg-accent"
                  >
                    <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
                      <Building2 className="size-5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{institution.name}</p>
                      <p className="text-sm text-muted-foreground">{TYPE_LABEL[institution.type]}</p>
                    </div>
                    <Badge tone={ROLE_TONE[role]}>{ROLE_LABEL[role]}</Badge>
                    <ChevronRight className="size-4 text-muted-foreground" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </Container>
  );
}

export default function InstitutionsPage() {
  return (
    <>
      <AppHeader />
      <RequireAuth>
        <InstitutionsList />
      </RequireAuth>
    </>
  );
}
