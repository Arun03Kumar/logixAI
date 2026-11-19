"use client";
import { useState } from "react";
import toast from "react-hot-toast";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AtSign, Building2, ChevronRight, Settings2 } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  Container,
  EmptyState,
  Input,
  PageHeader,
  Skeleton,
} from "@logixai/ui";
import AppHeader from "@/app/components/layout/AppHeader";
import RequireAuth from "@/app/components/layout/RequireAuth";
import { identityApi } from "@/app/lib/api/identity";
import { useApi } from "@/app/lib/api/useApi";
import { useSession } from "@/app/lib/auth/useSession";
import { ROLE_LABEL, ROLE_TONE, STATUS_LABEL, STATUS_TONE, TYPE_LABEL } from "./labels";

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

/** Institutions that accept people with the caller's email domain (after approval). */
function DomainSuggestions() {
  const suggested = useApi(() => identityApi.suggestedInstitutions(), []);
  const [busy, setBusy] = useState(null);
  const rows = suggested.data ?? [];
  if (!rows.length) return null;

  const ask = async (inst) => {
    setBusy(inst.id);
    try {
      await identityApi.requestToJoin(inst.id);
      suggested.setData((list) => list.map((x) => (x.id === inst.id ? { ...x, pending: true } : x)));
      toast.success(`Request sent to ${inst.name}.`);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="divide-y divide-border">
      {rows.map((inst) => (
        <div key={inst.id} className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center">
          <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary">
            <AtSign className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">{inst.name}</p>
            <p className="text-sm text-muted-foreground">
              Your email is from @{inst.domain}.{" "}
              {inst.pending ? "Your request is waiting for approval." : "Ask to join and a teacher or admin will approve you."}
            </p>
          </div>
          {inst.pending ? (
            <Badge tone="warning">Waiting</Badge>
          ) : (
            <Button size="sm" variant="primary" disabled={busy === inst.id} onClick={() => ask(inst)}>
              Ask to join
            </Button>
          )}
        </div>
      ))}
    </Card>
  );
}

function InstitutionsList() {
  const { user } = useSession();
  const { data, loading, error } = useApi(() => identityApi.me(), []);
  const memberships = data?.memberships ?? [];

  return (
    <Container className="py-10">
      <PageHeader
        title="Institutions"
        description="Schools and colleges you belong to. Tests and courses from your institution appear here."
        actions={
          user?.role === "admin" ? (
            <Button asChild size="sm" variant="outline">
              <Link href="/admin/institutions">
                <Settings2 />
                Institutions console
              </Link>
            </Button>
          ) : null
        }
      />

      <div className="space-y-6">
        <DomainSuggestions />
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
              description="Join with an invite code from your teacher or admin. Want LogixAI for your school or college? Write to info@logixai.com and we'll set it up."
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
                    {institution.status && institution.status !== "active" ? (
                      <Badge tone={STATUS_TONE[institution.status]}>{STATUS_LABEL[institution.status]}</Badge>
                    ) : null}
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
