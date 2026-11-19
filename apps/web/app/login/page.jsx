"use client";
import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, Field, Input, Spinner, Tabs } from "@logixai/ui";
import AuthShell from "@/app/components/layout/AuthShell";
import FormError from "@/app/components/forms/FormError";
import { signIn, signInWithRollNumber } from "@/app/lib/auth/session";
import { safeNext, useSession } from "@/app/lib/auth/useSession";

const LAST_INSTITUTION = "lx_last_institution";
/** The institution code used last time on this device. */
const readLastInstitution = () => {
  try {
    return window.localStorage.getItem(LAST_INSTITUTION) ?? "";
  } catch {
    return "";
  }
};
const rememberInstitution = (code) => {
  try {
    window.localStorage.setItem(LAST_INSTITUTION, code);
  } catch {
    // Private windows: nothing to remember.
  }
};

/** Where to go after signing in: a temporary password must be changed first. */
const afterSignIn = (user, next) =>
  user.mustChangePassword ? `/account/password?next=${encodeURIComponent(next)}` : next;

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const linkedInstitution = params.get("institution") ?? "";
  const session = useSession();
  const [mode, setMode] = useState(linkedInstitution ? "roll" : "email");
  // Rendered only in the browser (useSearchParams bails out of prerendering), so localStorage is safe here.
  const [form, setForm] = useState(() => ({
    email: "",
    password: "",
    institution: linkedInstitution || readLastInstitution(),
    rollNumber: "",
  }));
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  // Already signed in (e.g. came back to /login): go straight through.
  useEffect(() => {
    if (session.status === "authenticated" && !submitting) router.replace(afterSignIn(session.user, next));
  }, [session.status, session.user, submitting, router, next]);

  const update = (field) => (e) => {
    setForm((f) => ({ ...f, [field]: e.target.value }));
    setErrors((errs) => ({ ...errs, [field]: undefined }));
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setFormError(null);
    try {
      const user =
        mode === "roll"
          ? await signInWithRollNumber(form.institution.trim(), form.rollNumber.trim(), form.password)
          : await signIn(form.email, form.password);
      if (mode === "roll") rememberInstitution(form.institution.trim().toLowerCase());
      router.replace(afterSignIn(user, next));
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
      <Tabs
        size="sm"
        className="mb-6"
        aria-label="Sign in with"
        items={[
          { value: "email", label: "Email" },
          { value: "roll", label: "Roll number" },
        ]}
        value={mode}
        onValueChange={(m) => {
          setMode(m);
          setFormError(null);
          setErrors({});
        }}
      />
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <FormError message={formError} />
        {mode === "email" ? (
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
        ) : (
          <>
            <Field
              label="Institution code"
              htmlFor="institution"
              hint="Your school or college gives you this with your roll number."
              error={errors.institution}
            >
              <Input
                id="institution"
                autoComplete="organization"
                placeholder="e.g. abc-public-school"
                value={form.institution}
                onChange={update("institution")}
                aria-invalid={Boolean(errors.institution)}
                className="lowercase placeholder:normal-case"
                required
              />
            </Field>
            <Field label="Roll number" htmlFor="rollNumber" error={errors.rollNumber}>
              <Input
                id="rollNumber"
                autoComplete="username"
                value={form.rollNumber}
                onChange={update("rollNumber")}
                aria-invalid={Boolean(errors.rollNumber)}
                className="uppercase"
                required
              />
            </Field>
          </>
        )}
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
        {mode === "roll" ? (
          <p className="text-center text-xs text-muted-foreground">
            Forgot your password? Ask your teacher or institution admin for a new one.
          </p>
        ) : null}
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
