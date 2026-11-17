import Link from "next/link";
import { ArrowRight, BookOpen, ClipboardCheck, Code2 } from "lucide-react";
import { Badge, Card, Container } from "@logixai/ui";
import SectionHeading from "./SectionHeading";

const PILLARS = [
  {
    icon: BookOpen,
    title: "Courses",
    body: "Structured computer science courses taught by IITians, with video lessons, notes and exercises in one place.",
    status: "Coming soon",
  },
  {
    icon: Code2,
    title: "Coding practice",
    body: "Solve problems in Java, C++ and Python. Your code runs against test cases and you get a verdict in seconds.",
    href: "/problems",
    cta: "Open practice",
  },
  {
    icon: ClipboardCheck,
    title: "Tests for institutions",
    body: "Schools and colleges schedule computer science exams for their own batches, with proctoring and automatic grading.",
    status: "Coming soon",
  },
];

export default function PlatformSection() {
  return (
    <section id="platform" className="py-20 md:py-28">
      <Container size="xl">
        <SectionHeading eyebrow="The platform" title="Learn, practise and get tested in one place">
          One account for students, and one dashboard for the institutions that
          teach them.
        </SectionHeading>
        <div className="mt-12 grid gap-5 md:grid-cols-3">
          {PILLARS.map(({ icon: Icon, title, body, status, href, cta }) => (
            <Card key={title} className="flex flex-col p-6">
              <div className="flex items-center justify-between">
                <span className="grid size-10 place-items-center rounded-lg bg-primary-soft text-primary-soft-foreground">
                  <Icon className="size-5" />
                </span>
                {status ? <Badge>{status}</Badge> : null}
              </div>
              <h3 className="mt-5 text-lg font-semibold">{title}</h3>
              <p className="mt-2 flex-1 text-sm leading-relaxed text-muted-foreground">
                {body}
              </p>
              {href ? (
                <Link
                  href={href}
                  className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline"
                >
                  {cta}
                  <ArrowRight className="size-4" />
                </Link>
              ) : null}
            </Card>
          ))}
        </div>
      </Container>
    </section>
  );
}
