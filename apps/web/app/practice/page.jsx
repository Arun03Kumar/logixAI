"use client";
import Link from "next/link";
import { ArrowRight, BrainCircuit, Code2, GraduationCap, Globe, Network, Timer, Trophy, UserRound } from "lucide-react";
import { Card, Container, PageHeader } from "@logixai/ui";
import AppHeader from "@/app/components/layout/AppHeader";
import { arenaApi } from "@/app/lib/api/arena";
import { useApi } from "@/app/lib/api/useApi";
import { useSession } from "@/app/lib/auth/useSession";
import { MasteryBar } from "../arena/_components/bits";

/** The areas, each with its own pages (the header links to them too). */
const AREA_CARDS = [
  {
    href: "/arena",
    icon: BrainCircuit,
    title: "ML Arena",
    text: "The full path into machine learning: maths and Python from zero, then SQL, Pandas, NumPy, ML, PyTorch and LLM apps — lessons, labs and interview practice.",
  },
  {
    href: "/problems",
    icon: Code2,
    title: "Data structures and algorithms",
    text: "Classic coding problems in Python, Java and C++, judged on hidden tests.",
  },
  {
    href: "/frontend",
    icon: Globe,
    title: "Frontend",
    text: "JavaScript and React interview problems on a real DOM and a fake clock, plus a live playground.",
  },
  {
    href: "/system-design",
    icon: Network,
    title: "System design",
    text: "Build rate limiters, load balancers and caches against simulated traffic, and practise design write-ups.",
  },
];

/** Timed practice and your profile, across every area. */
const COMPETE = [
  {
    href: "/practice/mock",
    icon: Timer,
    title: "Mock interviews",
    text: "Timed rounds for data, ML, frontend, system design and LLM roles, with a report afterwards.",
  },
  { href: "/practice/contests", icon: Trophy, title: "Weekly contests", text: "Every Sunday: four questions, 90 minutes, a leaderboard. Free for everyone." },
  { href: "/practice/profile", icon: UserRound, title: "Your public profile", text: "Solved counts, streak and contest ranks on a page you can share." },
];

function LinkCard({ href, icon: Icon, title, text }) {
  return (
    <Link href={href} className="group">
      <Card className="flex h-full flex-col gap-2 p-5 transition-colors group-hover:border-primary">
        <span className="grid size-10 place-items-center rounded-lg bg-primary-soft text-primary">
          <Icon className="size-5" />
        </span>
        <p className="font-semibold">{title}</p>
        <p className="text-sm text-muted-foreground">{text}</p>
        <span className="mt-auto inline-flex items-center gap-1 pt-1 text-sm text-primary">
          Open <ArrowRight className="size-4" />
        </span>
      </Card>
    </Link>
  );
}

export default function PracticeHub() {
  const { status } = useSession();
  const courses = useApi(() => arenaApi.courses("ml"), [status], { enabled: status !== "loading" });
  const course = courses.data?.[0];

  return (
    <>
      <AppHeader />
      <main className="py-8">
        <Container size="xl" className="space-y-10">
          <PageHeader
            title="Practice"
            description="Pick an area to learn and practise in, or test yourself under interview conditions."
          />

          {course ? (
            <Link href={`/arena/course/${course.id}`} className="group block">
              <Card className="flex flex-wrap items-center gap-4 border-primary p-5 transition-colors group-hover:bg-accent">
                <span className="grid size-12 place-items-center rounded-lg bg-primary text-primary-foreground">
                  <GraduationCap className="size-6" />
                </span>
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="font-semibold">New to ML? {course.title}</p>
                  <p className="text-sm text-muted-foreground">{course.summary}</p>
                  {course.solvedCount ? <MasteryBar value={course.mastery} label="Course" /> : null}
                </div>
                <span className="inline-flex items-center gap-1 text-sm font-medium text-primary">
                  {course.solvedCount ? "Continue" : "Start the course"} <ArrowRight className="size-4" />
                </span>
              </Card>
            </Link>
          ) : null}

          <section className="space-y-3">
            <h2 className="text-lg font-semibold">Areas</h2>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              {AREA_CARDS.map((c) => (
                <LinkCard key={c.href} {...c} />
              ))}
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold">Interview conditions</h2>
            <div className="grid gap-4 md:grid-cols-3">
              {COMPETE.map((c) => (
                <LinkCard key={c.href} {...c} />
              ))}
            </div>
          </section>
        </Container>
      </main>
    </>
  );
}
