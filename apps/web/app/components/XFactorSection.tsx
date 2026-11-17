import { Check } from "lucide-react";
import { Container } from "@logixai/ui";
import SectionHeading from "./SectionHeading";

const POINTS = [
  "Find the logic behind every “why”",
  "Learn directly from IITians",
  "Develop deep analytical thinking",
  "Discover your own X factor",
  "Use AI-assisted tools the right way",
];

export default function XFactorSection() {
  return (
    <section className="py-20 md:py-28">
      <Container size="xl" className="grid gap-12 lg:grid-cols-2 lg:items-center">
        <SectionHeading eyebrow="The LogixAI edge" title="Discover your X">
          The X stands for the potential inside every learner. Our goal is to
          help students uncover their strengths, think clearly and logically,
          and build the skills to do well in an AI-powered world.
        </SectionHeading>
        <ul className="divide-y divide-border rounded-lg border border-border bg-card">
          {POINTS.map((text) => (
            <li key={text} className="flex items-center gap-3 px-5 py-4 text-sm font-medium">
              <span className="grid size-6 shrink-0 place-items-center rounded-full bg-success-soft text-success">
                <Check className="size-3.5" />
              </span>
              {text}
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}
