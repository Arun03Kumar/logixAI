import Link from "next/link";
import { ArrowRight } from "lucide-react";
import {
  Badge,
  Button,
  Container,
  DifficultyBadge,
  VerdictBadge,
} from "@logixai/ui";

/** Static preview of the practice workspace, in place of an illustration. */
function ProductPreview() {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-[0_24px_48px_-24px_rgb(31_29_26/0.25)]">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">Wizard&apos;s square spell</span>
          <DifficultyBadge difficulty="medium" />
        </div>
        <Badge tone="outline">Python</Badge>
      </div>
      <div className="grid sm:grid-cols-[0.9fr_1.1fr]">
        <div className="space-y-2 border-b border-border p-4 text-sm leading-relaxed text-muted-foreground sm:border-b-0 sm:border-r">
          <p className="text-foreground">
            Given an integer <code className="rounded bg-muted px-1 font-mono text-[13px]">n</code>,
            print its square.
          </p>
          <p>Input: a single integer n.</p>
          <p>Output: n squared.</p>
        </div>
        <pre className="bg-[#1e1e1e] p-4 font-mono text-[13px] leading-6 text-[#d4d4d4]">
          <code>
            <span className="text-[#569cd6]">def</span>{" "}
            <span className="text-[#dcdcaa]">square</span>(n):{"\n"}
            {"    "}
            <span className="text-[#c586c0]">return</span> n * n
          </code>
        </pre>
      </div>
      <div className="flex items-center justify-between border-t border-border bg-muted px-4 py-3">
        <div className="flex items-center gap-2 text-sm">
          <VerdictBadge status="SUCCESS" />
          <span className="text-muted-foreground">2 of 2 tests passed</span>
        </div>
        <span className="text-xs text-muted-foreground">Java · C++ · Python</span>
      </div>
    </div>
  );
}

export default function HeroSection() {
  return (
    <section className="border-b border-border">
      <Container
        size="xl"
        className="grid items-center gap-12 py-16 md:py-24 lg:grid-cols-[1.05fr_1fr]"
      >
        <div>
          <Badge tone="brand">Founded by IITians</Badge>
          <h1 className="mt-5 text-4xl font-bold leading-[1.1] text-foreground sm:text-5xl lg:text-[56px]">
            Find your <span className="text-primary">X factor</span>.
          </h1>
          <p className="mt-5 max-w-xl text-lg leading-relaxed text-muted-foreground">
            LogixAI helps students find the logic behind every &ldquo;why&rdquo;.
            Learn computer science from IIT graduates, practise coding with
            instant feedback, and take tests set by your school or college.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild variant="primary" size="lg">
              <Link href="/problems">
                Start practicing
                <ArrowRight />
              </Link>
            </Button>
            <Button asChild size="lg">
              <Link href="#services">For institutions</Link>
            </Button>
          </div>
          <p className="mt-8 text-sm text-muted-foreground">
            Built by graduates of IIT Delhi, IIT Jodhpur and IIIT Lucknow.
          </p>
        </div>
        <ProductPreview />
      </Container>
    </section>
  );
}
