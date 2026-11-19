"use client";
import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { Building2, Clock } from "lucide-react";
import { Button, Card, Field, Input, Skeleton, Spinner } from "@logixai/ui";
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
  const [rollNumber, setRollNumber] = useState("");
  const [pending, setPending] = useState(null);

  const here = `/join/${encodeURIComponent(code)}`;

  const join = async () => {
    setJoining(true);
    setError(null);
    try {
      const result = await identityApi.acceptInvite(code, rollNumber.trim() ? { rollNumber: rollNumber.trim() } : {});
      if (result.pending) {
        setPending(result.institution);
        setJoining(false);
        return;
      }
      toast.success(`You joined ${result.institution.name}.`);
      router.push(`/institutions/${result.institution.id}`);
    } catch (err) {
      setError(err.fieldErrors?.rollNumber ?? err.message);
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

  if (pending) {
    return (
      <AuthShell title="Request sent">
        <Card className="p-5">
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-warning-soft text-warning">
              <Clock className="size-5" />
            </span>
            <div>
              <p className="font-semibold">Waiting for {pending.name}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                A teacher or admin will approve you soon. You&apos;ll find the institution under Institutions once they do.
              </p>
            </div>
          </div>
        </Card>
        <Button asChild className="mt-6 w-full">
          <Link href="/institutions">Go to Institutions</Link>
        </Button>
      </AuthShell>
    );
  }

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
        {invite.requiresApproval ? (
          <p className="mt-2 text-sm text-muted-foreground">A teacher or admin approves each person before they join.</p>
        ) : null}
      </Card>

      <div className="mt-6 space-y-3">
        {!invite.valid ? (
          <FormError message={REASONS[invite.reason] ?? "This invite can't be used."} />
        ) : status === "authenticated" ? (
          <>
            <FormError message={error} />
            {invite.asksRollNumber ? (
              <Field label="Roll number (optional)" htmlFor="join-roll" hint="Lets you sign in with your roll number too.">
                <Input
                  id="join-roll"
                  className="uppercase"
                  value={rollNumber}
                  onChange={(e) => setRollNumber(e.target.value)}
                />
              </Field>
            ) : null}
            <Button variant="primary" className="w-full" onClick={join} disabled={joining}>
              {joining ? <Spinner className="text-primary-foreground" /> : null}
              {invite.requiresApproval ? `Ask to join ${invite.institution.name}` : `Join ${invite.institution.name}`}
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
