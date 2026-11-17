import { BrainCircuit, Cpu, Sparkles } from "lucide-react";
import { Container } from "@logixai/ui";
import SectionHeading from "./SectionHeading";

const CONCEPTS = [
  {
    icon: BrainCircuit,
    title: "Logix",
    body: "Strong logic is the foundation of all great learning. Our programs sharpen reasoning, analytical thinking and problem solving, building the mental frameworks needed to excel in any field.",
  },
  {
    icon: Sparkles,
    title: "X factor",
    body: "The X is the hidden potential inside every learner. We help students discover their strengths, build on them and realise what makes them stand out.",
  },
  {
    icon: Cpu,
    title: "AI",
    body: "AI is reshaping education. LogixAI combines AI-assisted learning with rigorous conceptual foundations, so students build skills that matter today and tomorrow.",
  },
];

export default function AboutSection() {
  return (
    <section id="about" className="border-y border-border bg-card py-20 md:py-28">
      <Container size="xl">
        <SectionHeading eyebrow="Our philosophy" title="What is LogixAI?">
          Every student has an X factor waiting to be discovered. We help
          learners find the logic behind every &ldquo;why&rdquo; and develop deep
          analytical thinking, guided by IITians and experienced educators.
        </SectionHeading>
        <div className="mt-12 grid gap-10 md:grid-cols-3">
          {CONCEPTS.map(({ icon: Icon, title, body }) => (
            <div key={title}>
              <Icon className="size-6 text-primary" aria-hidden="true" />
              <h3 className="mt-4 text-lg font-semibold">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {body}
              </p>
            </div>
          ))}
        </div>
      </Container>
    </section>
  );
}
