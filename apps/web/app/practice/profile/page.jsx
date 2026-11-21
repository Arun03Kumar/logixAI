"use client";
import { useState } from "react";
import Link from "next/link";
import toast from "react-hot-toast";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { Button, Card, Checkbox, Container, Input, Label, PageHeader, Skeleton, Textarea } from "@logixai/ui";
import AppHeader from "@/app/components/layout/AppHeader";
import { arenaApi } from "@/app/lib/api/arena";
import { useApi } from "@/app/lib/api/useApi";
import { useSession } from "@/app/lib/auth/useSession";
import { SignInPrompt } from "../_components/session";

function ProfileForm({ initial }) {
  const [form, setForm] = useState({ handle: initial.handle, displayName: initial.displayName, bio: initial.bio, public: initial.public });
  const [saved, setSaved] = useState(initial.saved ? initial : null);
  const [busy, setBusy] = useState(false);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const result = await arenaApi.saveProfile(form);
      setSaved(result);
      setForm({ handle: result.handle, displayName: result.displayName, bio: result.bio, public: result.public });
      toast.success(result.public ? "Saved — your profile is public." : "Saved. Your profile is private.");
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-5">
      <form onSubmit={save} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="handle">Handle</Label>
          <Input id="handle" value={form.handle} onChange={set("handle")} maxLength={20} autoComplete="off" />
          <p className="text-xs text-muted-foreground">3–20 lowercase letters, digits or underscores. Your page: /u/{form.handle || "…"}</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="displayName">Display name</Label>
          <Input id="displayName" value={form.displayName} onChange={set("displayName")} maxLength={60} />
          <p className="text-xs text-muted-foreground">Shown on your profile and on contest leaderboards when your profile is public.</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="bio">About you</Label>
          <Textarea id="bio" value={form.bio} onChange={set("bio")} maxLength={280} rows={3} placeholder="e.g. Final-year CS student preparing for data science roles" />
        </div>
        <Checkbox
          checked={form.public}
          onChange={set("public")}
          label="Make my profile public"
          description="Anyone with the link sees your handle, display name, bio, solved counts, streak, recent solves and contest ranks. Never your email or code."
        />
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="primary" size="sm" disabled={busy}>
            Save
          </Button>
          {saved?.public ? (
            <Link href={saved.url} className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
              View public profile
              <ExternalLink className="size-3.5" />
            </Link>
          ) : null}
        </div>
      </form>
    </Card>
  );
}

export default function ProfileSettingsPage() {
  const { status } = useSession();
  const signedIn = status === "authenticated";
  const profile = useApi(() => arenaApi.myProfile(), [status], { enabled: signedIn });
  return (
    <>
      <AppHeader />
      <main className="py-8">
        <Container size="sm" className="space-y-6">
          <Link href="/practice" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-4" />
            Practice
          </Link>
          <PageHeader title="Your profile" description="A public page with what you've practised — handy for a CV or LinkedIn. Private until you choose otherwise." />
          {!signedIn ? (
            status === "loading" ? <Skeleton className="h-64" /> : <SignInPrompt next="/practice/profile" what="set up your profile" />
          ) : profile.data ? (
            <ProfileForm initial={profile.data} />
          ) : (
            <Skeleton className="h-64" />
          )}
        </Container>
      </main>
    </>
  );
}
