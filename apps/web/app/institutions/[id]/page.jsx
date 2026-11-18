"use client";
import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { AlertCircle, ChevronLeft } from "lucide-react";
import {
  Badge,
  Button,
  Container,
  EmptyState,
  Skeleton,
  Tabs,
} from "@logixai/ui";
import AppHeader from "@/app/components/layout/AppHeader";
import RequireAuth from "@/app/components/layout/RequireAuth";
import { identityApi } from "@/app/lib/api/identity";
import { useApi } from "@/app/lib/api/useApi";
import { useSession } from "@/app/lib/auth/useSession";
import { ROLE_LABEL, ROLE_TONE, TYPE_LABEL, canManage, canView } from "../labels";
import MembersTab from "./_components/MembersTab";
import BatchesTab from "./_components/BatchesTab";
import InvitesTab from "./_components/InvitesTab";
import ExamsTab from "./_components/ExamsTab";
import ArenaTab from "./_components/ArenaTab";

function InstitutionDetail() {
  const { id } = useParams();
  const router = useRouter();
  const { user } = useSession();
  const { data, loading, error } = useApi(() => identityApi.getInstitution(id), [id]);
  const [tab, setTab] = useState("exams");

  if (loading) {
    return (
      <Container className="space-y-3 py-10">
        <Skeleton className="h-7 w-1/3" />
        <Skeleton className="h-4 w-1/5" />
      </Container>
    );
  }
  if (error) {
    return (
      <Container className="py-16">
        <EmptyState
          icon={<AlertCircle />}
          title="Institution not found"
          description="It doesn't exist or you're not a member."
          action={
            <Button asChild size="sm">
              <Link href="/institutions">Back to institutions</Link>
            </Button>
          }
        />
      </Container>
    );
  }

  const { institution, role } = data;

  const leave = async () => {
    if (!window.confirm(`Leave ${institution.name}? You'll need a new invite to rejoin.`)) return;
    try {
      await identityApi.removeMember(id, user.id);
      toast.success(`You left ${institution.name}.`);
      router.push("/institutions");
    } catch (err) {
      toast.error(err.message);
    }
  };

  const tabs = [
    { value: "exams", label: "Exams" },
    { value: "arena", label: "ML Arena" },
    ...(canView(role)
      ? [
          { value: "members", label: "Members" },
          { value: "batches", label: "Batches" },
        ]
      : []),
    ...(canManage(role) ? [{ value: "invites", label: "Invites" }] : []),
  ];

  return (
    <Container className="py-10">
      <Button asChild variant="ghost" size="sm" className="-ml-2 mb-4">
        <Link href="/institutions">
          <ChevronLeft />
          Institutions
        </Link>
      </Button>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">{institution.name}</h1>
        <Badge tone={ROLE_TONE[role]}>{ROLE_LABEL[role]}</Badge>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{TYPE_LABEL[institution.type]}</p>

      <div className="mt-8">
        <Tabs items={tabs} value={tab} onValueChange={setTab} aria-label="Institution sections" />
        <div className="mt-6">
          {tab === "exams" && <ExamsTab institutionId={id} myRole={role} />}
          {tab === "arena" && <ArenaTab institutionId={id} myRole={role} />}
          {tab === "members" && canView(role) && (
            <MembersTab institutionId={id} myRole={role} myUserId={user.id} />
          )}
          {tab === "batches" && canView(role) && <BatchesTab institutionId={id} myRole={role} />}
          {tab === "invites" && canManage(role) && <InvitesTab institutionId={id} myRole={role} />}
        </div>
      </div>

      {role === "student" ? (
        <Button
          variant="ghost"
          size="sm"
          className="mt-10 px-0 text-danger hover:bg-transparent"
          onClick={leave}
        >
          Leave institution
        </Button>
      ) : null}
    </Container>
  );
}

export default function InstitutionPage() {
  return (
    <>
      <AppHeader />
      <RequireAuth>
        <InstitutionDetail />
      </RequireAuth>
    </>
  );
}
