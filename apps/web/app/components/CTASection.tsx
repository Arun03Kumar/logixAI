import Link from "next/link";
import { Button, Container } from "@logixai/ui";

export default function CTASection() {
  return (
    <section className="pb-20 md:pb-28">
      <Container size="xl">
        <div className="flex flex-col items-start justify-between gap-8 rounded-xl border border-border bg-primary-soft px-8 py-12 md:flex-row md:items-center md:px-12">
          <div className="max-w-xl">
            <h2 className="text-2xl font-bold text-foreground md:text-3xl">
              Ready to find your X factor?
            </h2>
            <p className="mt-3 text-base leading-relaxed text-muted-foreground">
              Learn the logic behind every &ldquo;why&rdquo;, guided by IITians.
              Start with coding practice today, or talk to us about bringing
              LogixAI to your institution.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button asChild variant="primary" size="lg">
              <Link href="/problems">Start practicing</Link>
            </Button>
            <Button asChild size="lg">
              <a href="mailto:info@logixai.com">Contact us</a>
            </Button>
          </div>
        </div>
      </Container>
    </section>
  );
}
