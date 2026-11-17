"use client";
import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { Building2 } from "lucide-react";
import { Button, Card, Skeleton, Spinner } from "@logixai/ui";
import AuthShell from "@/app/components/layout/AuthShell";
import FormError from "@/app/components/forms/FormError";
import { identityApi } from "@/app/lib/api/identity";
import { useApi } from "@/app/lib/api/useApi";
import { useSession } from "@/app/lib/auth/useSession";
import { ROLE_LABEL, TYPE_LABEL } from "@/app/institutions/labels";

const REASONS = {
  expired: "This invite has expired. Ask your institution for a new one.",
  revoked: "This invite is no longer active. Ask your institution for a new one.",
  used_up: "This invite has been used the maximum number of times.",
};

export default function JoinPage() {
  const { code } = useParams();
  const router = useRouter();
  const { status } = useSession();
  const preview = useApi(() => identityApi.previewInvite(code), [code]);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState(null);

  const here = `/join/${encodeURIComponent(code)}`;

  const join = async () => {
    setJoining(true);
    setError(null);
    try {
      const membership = await identityApi.acceptInvite(code);
      toast.success(`You joined ${membership.institution.name}.`);
      router.push(`/institutions/${membership.institution.id}`);
    } catch (err) {
      setError(err.message);
      setJoining(false);
    }
  };

  if (preview.loading) {
    return (
      <AuthShell title="Join an institution">
        <Skeleton className="h-28 w-full" />
      </AuthShell>
    );
  }

  if (preview.error) {
    return (
      <AuthShell
        title="Invite not found"
        description="Check the code and try again. Codes look like K7QM-2XPA."
        footer={
          <Link href="/institutions" className="font-semibold text-primary hover:underline">
            Enter a different code
          </Link>
        }
      >
        {null}
      </AuthShell>
    );
  }

  const invite = preview.data;

  return (
    <AuthShell title="Join an institution">
      <Card className="p-5">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
            <Building2 className="size-5" />
          </span>
          <div>
            <p className="font-semibold">{invite.institution.name}</p>
            <p className="text-sm text-muted-foreground">{TYPE_LABEL[invite.institution.type]}</p>
          </div>
        </div>
        <p className="mt-4 text-sm">
          You&apos;re invited to join as{" "}
          <span className="font-semibold">{ROLE_LABEL[invite.role].toLowerCase()}</span>
          {invite.batchName ? (
            <>
              {" "}in <span className="font-semibold">{invite.batchName}</span>
            </>
          ) : null}
          .
        </p>
      </Card>

      <div className="mt-6 space-y-3">
        {!invite.valid ? (
          <FormError message={REASONS[invite.reason] ?? "This invite can't be used."} />
        ) : status === "authenticated" ? (
          <>
            <FormError message={error} />
            <Button variant="primary" className="w-full" onClick={join} disabled={joining}>
              {joining ? <Spinner className="text-primary-foreground" /> : null}
              Join {invite.institution.name}
            </Button>
          </>
        ) : status === "anonymous" ? (
          <>
            <Button asChild variant="primary" className="w-full">
              <Link href={`/signup?next=${encodeURIComponent(here)}`}>Create an account to join</Link>
            </Button>
            <Button asChild className="w-full">
              <Link href={`/login?next=${encodeURIComponent(here)}`}>I already have an account</Link>
            </Button>
          </>
        ) : (
          <Skeleton className="h-9 w-full" />
        )}
      </div>
    </AuthShell>
  );
}
