"use client";
import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import toast from "react-hot-toast";
import { Button, Field, Input, Spinner } from "@logixai/ui";
import AuthShell from "@/app/components/layout/AuthShell";
import FormError from "@/app/components/forms/FormError";
import { changePassword } from "@/app/lib/auth/session";
import { safeNext, useRequireAuth } from "@/app/lib/auth/useSession";

function PasswordForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"), "/institutions");
  const { status, user } = useRequireAuth();
  const [form, setForm] = useState({ currentPassword: "", newPassword: "", confirm: "" });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [saving, setSaving] = useState(false);

  const update = (field) => (e) => {
    setForm((f) => ({ ...f, [field]: e.target.value }));
    setErrors((errs) => ({ ...errs, [field]: undefined }));
  };

  const submit = async (e) => {
    e.preventDefault();
    if (form.newPassword !== form.confirm) {
      setErrors({ confirm: "The passwords don't match." });
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      await changePassword(form.currentPassword, form.newPassword);
      toast.success("Your password is changed. Other devices were signed out.");
      router.replace(next);
    } catch (err) {
      setErrors(err.fieldErrors ?? {});
      setFormError(err.message);
      setSaving(false);
    }
  };

  if (status !== "authenticated") {
    return (
      <AuthShell title="Change your password">
        <Spinner className="size-5" />
      </AuthShell>
    );
  }

  const forced = user.mustChangePassword;

  return (
    <AuthShell
      title={forced ? "Choose your own password" : "Change your password"}
      description={
        forced
          ? "You signed in with a temporary password from your institution. Pick a new one that only you know."
          : "You'll stay signed in here. Other devices are signed out."
      }
      footer={
        forced ? null : (
          <Link href={next} className="font-semibold text-primary hover:underline">
            Cancel
          </Link>
        )
      }
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        <FormError message={formError} />
        <Field label={forced ? "Temporary password" : "Current password"} htmlFor="current" error={errors.currentPassword}>
          <Input
            id="current"
            type="password"
            autoComplete="current-password"
            value={form.currentPassword}
            onChange={update("currentPassword")}
            required
          />
        </Field>
        <Field label="New password" htmlFor="new" hint="At least 8 characters." error={errors.newPassword}>
          <Input id="new" type="password" autoComplete="new-password" value={form.newPassword} onChange={update("newPassword")} required />
        </Field>
        <Field label="New password again" htmlFor="confirm" error={errors.confirm}>
          <Input id="confirm" type="password" autoComplete="new-password" value={form.confirm} onChange={update("confirm")} required />
        </Field>
        <Button type="submit" variant="primary" className="w-full" disabled={saving}>
          {saving ? <Spinner className="text-primary-foreground" /> : null}
          Save password
        </Button>
      </form>
    </AuthShell>
  );
}

export default function PasswordPage() {
  return (
    <Suspense fallback={null}>
      <PasswordForm />
    </Suspense>
  );
}
