"use client";
import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { AlertCircle, ChevronLeft, LifeBuoy } from "lucide-react";
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
import { ROLE_LABEL, ROLE_TONE, TYPE_LABEL, can } from "../labels";
import MembersTab from "./_components/MembersTab";
import BatchesTab from "./_components/BatchesTab";
import DepartmentsTab from "./_components/DepartmentsTab";
import InvitesTab from "./_components/InvitesTab";
import ExamsTab from "./_components/ExamsTab";
import ArenaTab from "./_components/ArenaTab";
import RequestsTab from "./_components/RequestsTab";
import QuestionBankTab from "./_components/QuestionBankTab";

function InstitutionDetail() {
  const { id } = useParams();
  const router = useRouter();
  const { user } = useSession();
  const { data, loading, error } = useApi(() => identityApi.getInstitution(id), [id]);
  const [tab, setTab] = useState(null);

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
          title={error.status === 403 ? "This institution is closed" : "Institution not found"}
          description={error.status === 403 ? error.message : "It doesn't exist or you're not a member."}
          action={
            <Button asChild size="sm">
              <Link href="/institutions">Back to institutions</Link>
            </Button>
          }
        />
      </Container>
    );
  }

  const { institution, role, access } = data;
  const features = institution.features ?? {};
  const seesStructure = can(access, "reports.view");

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
    ...(features.exams !== false ? [{ value: "exams", label: "Exams" }] : []),
    ...(features.exams !== false && can(access, "tests.manage") ? [{ value: "bank", label: "Question bank" }] : []),
    ...(features.arena !== false ? [{ value: "arena", label: "ML Arena" }] : []),
    ...(seesStructure
      ? [
          { value: "members", label: "Members" },
          { value: "batches", label: "Batches" },
        ]
      : []),
    ...(access?.scope?.all ? [{ value: "departments", label: "Departments" }] : []),
    ...(can(access, "people.manage")
      ? [
          { value: "invites", label: "Invites" },
          { value: "requests", label: "Requests" },
        ]
      : []),
  ];
  const current = tabs.some((t) => t.value === tab) ? tab : tabs[0]?.value;

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
      <p className="mt-1 text-sm text-muted-foreground">
        {TYPE_LABEL[institution.type]}
        {features.rollNumberLogin && can(access, "people.manage") ? (
          <>
            {" "}· Institution code for roll-number sign-in:{" "}
            <span className="font-mono font-medium text-foreground">{institution.slug}</span>
          </>
        ) : null}
      </p>
      {access?.support ? (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-info/30 bg-info-soft px-4 py-3 text-sm text-info">
          <LifeBuoy className="mt-0.5 size-4 shrink-0" />
          <span>
            You&apos;re viewing as LogixAI support with owner access. What you change here is recorded in the
            institution&apos;s audit log.
          </span>
        </div>
      ) : null}

      <div className="mt-8">
        {tabs.length ? (
          <Tabs items={tabs} value={current} onValueChange={setTab} aria-label="Institution sections" />
        ) : (
          <EmptyState title="Nothing here yet" description="Your institution hasn't switched on any features for you." />
        )}
        <div className="mt-6">
          {current === "exams" && <ExamsTab institutionId={id} access={access} />}
          {current === "arena" && <ArenaTab institutionId={id} access={access} />}
          {current === "bank" && <QuestionBankTab institutionId={id} access={access} subjective={features.subjective === true} />}
          {current === "members" && <MembersTab institution={institution} access={access} myUserId={user.id} />}
          {current === "batches" && <BatchesTab institutionId={id} access={access} />}
          {current === "departments" && <DepartmentsTab institutionId={id} access={access} />}
          {current === "invites" && <InvitesTab institutionId={id} institutionName={institution.name} access={access} />}
          {current === "requests" && <RequestsTab institutionId={id} access={access} />}
        </div>
      </div>

      {role === "student" && !access?.support ? (
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
