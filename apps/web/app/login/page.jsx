"use client";
import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, Field, Input, Spinner } from "@logixai/ui";
import AuthShell from "@/app/components/layout/AuthShell";
import FormError from "@/app/components/forms/FormError";
import { signIn } from "@/app/lib/auth/session";
import { safeNext, useSession } from "@/app/lib/auth/useSession";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const session = useSession();
  const [form, setForm] = useState({ email: "", password: "" });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  // Already signed in (e.g. came back to /login): go straight through.
  useEffect(() => {
    if (session.status === "authenticated") router.replace(next);
  }, [session.status, router, next]);

  const update = (field) => (e) => {
    setForm((f) => ({ ...f, [field]: e.target.value }));
    setErrors((errs) => ({ ...errs, [field]: undefined }));
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setFormError(null);
    try {
      await signIn(form.email, form.password);
      router.replace(next);
    } catch (err) {
      setErrors(err.fieldErrors ?? {});
      setFormError(err.message);
      setSubmitting(false);
    }
  };

  const signupHref = `/signup${next !== "/problems" ? `?next=${encodeURIComponent(next)}` : ""}`;

  return (
    <AuthShell
      title="Sign in"
      description="Welcome back. Sign in to practise, take tests and see your progress."
      footer={
        <>
          New to LogixAI?{" "}
          <Link href={signupHref} className="font-semibold text-primary hover:underline">
            Create an account
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <FormError message={formError} />
        <Field label="Email" htmlFor="email" error={errors.email}>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            placeholder="you@college.edu"
            value={form.email}
            onChange={update("email")}
            aria-invalid={Boolean(errors.email)}
            required
          />
        </Field>
        <Field label="Password" htmlFor="password" error={errors.password}>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            value={form.password}
            onChange={update("password")}
            aria-invalid={Boolean(errors.password)}
            required
          />
        </Field>
        <Button type="submit" variant="primary" className="w-full" disabled={submitting}>
          {submitting ? <Spinner className="text-primary-foreground" /> : null}
          Sign in
        </Button>
      </form>
    </AuthShell>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
