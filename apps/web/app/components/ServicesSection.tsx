import { Building2, GraduationCap, Lightbulb, Sparkles } from "lucide-react";
import { Badge, Card, Container } from "@logixai/ui";
import SectionHeading from "./SectionHeading";

const SERVICES = [
  {
    icon: GraduationCap,
    title: "IITian mentorship",
    body: "Learn directly from IIT graduates who teach with conceptual clarity, real-world problem solving and exam strategies that work.",
    tag: "1-on-1 and group",
  },
  {
    icon: Building2,
    title: "University faculty support",
    body: "We provide qualified, IIT-trained faculty to universities and institutions, raising the standard of teaching and student outcomes.",
    tag: "Institutional",
  },
  {
    icon: Lightbulb,
    title: "Logical thinking programs",
    body: "A curriculum designed to strengthen reasoning, analytical thinking and conceptual understanding, the foundation of academic success.",
    tag: "Core program",
  },
  {
    icon: Sparkles,
    title: "AI-driven learning",
    body: "Learning that adapts to each student, so complex ideas are understood faster and more thoroughly.",
    tag: "Future-ready",
  },
];

export default function ServicesSection() {
  return (
    <section id="services" className="border-y border-border bg-card py-20 md:py-28">
      <Container size="xl">
        <SectionHeading eyebrow="What we offer" title="Services for students and institutions">
          From mentorship to AI-assisted tools, everything a learner needs to
          discover their X factor and go further.
        </SectionHeading>
        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {SERVICES.map(({ icon: Icon, title, body, tag }) => (
            <Card key={title} className="flex flex-col bg-background p-6">
              <Icon className="size-6 text-primary" aria-hidden="true" />
              <h3 className="mt-4 text-base font-semibold">{title}</h3>
              <p className="mt-2 flex-1 text-sm leading-relaxed text-muted-foreground">
                {body}
              </p>
              <Badge className="mt-5 self-start">{tag}</Badge>
            </Card>
          ))}
        </div>
      </Container>
    </section>
  );
}
