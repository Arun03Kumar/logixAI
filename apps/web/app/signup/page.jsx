"use client";
import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, Field, Input, Spinner } from "@logixai/ui";
import AuthShell from "@/app/components/layout/AuthShell";
import FormError from "@/app/components/forms/FormError";
import { signUp } from "@/app/lib/auth/session";
import { safeNext, useSession } from "@/app/lib/auth/useSession";

function SignupForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const session = useSession();
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (session.status === "authenticated" && !submitting) router.replace(next);
  }, [session.status, router, next, submitting]);

  const update = (field) => (e) => {
    setForm((f) => ({ ...f, [field]: e.target.value }));
    setErrors((errs) => ({ ...errs, [field]: undefined }));
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setFormError(null);
    try {
      await signUp(form.name, form.email, form.password);
      router.replace(next);
    } catch (err) {
      setErrors(err.fieldErrors ?? {});
      setFormError(err.message);
      setSubmitting(false);
    }
  };

  const loginHref = `/login${next !== "/problems" ? `?next=${encodeURIComponent(next)}` : ""}`;

  return (
    <AuthShell
      title="Create your account"
      description="Practise coding, take your institution's tests and track your progress."
      footer={
        <>
          Already have an account?{" "}
          <Link href={loginHref} className="font-semibold text-primary hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <FormError message={formError} />
        <Field label="Full name" htmlFor="name" error={errors.name}>
          <Input
            id="name"
            autoComplete="name"
            placeholder="Asha Rao"
            value={form.name}
            onChange={update("name")}
            aria-invalid={Boolean(errors.name)}
            required
          />
        </Field>
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
        <Field
          label="Password"
          htmlFor="password"
          hint="At least 8 characters."
          error={errors.password}
        >
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            value={form.password}
            onChange={update("password")}
            aria-invalid={Boolean(errors.password)}
            required
          />
        </Field>
        <Button type="submit" variant="primary" className="w-full" disabled={submitting}>
          {submitting ? <Spinner className="text-primary-foreground" /> : null}
          Create account
        </Button>
      </form>
    </AuthShell>
  );
}

export default function SignupPage() {
  return (
    <Suspense fallback={null}>
      <SignupForm />
    </Suspense>
  );
}
