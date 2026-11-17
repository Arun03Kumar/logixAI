import Link from "next/link";
import { Container, Logo } from "@logixai/ui";

const COLUMNS = [
  {
    title: "Product",
    links: [
      { label: "Coding practice", href: "/problems" },
      { label: "Platform", href: "/#platform" },
      { label: "For institutions", href: "/#services" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "About", href: "/#about" },
      { label: "Team", href: "/#team" },
      { label: "Careers", href: "mailto:info@logixai.com" },
    ],
  },
  {
    title: "Contact",
    links: [
      { label: "info@logixai.com", href: "mailto:info@logixai.com" },
      { label: "India", href: null },
    ],
  },
];

export default function Footer() {
  return (
    <footer id="contact" className="border-t border-border bg-card">
      <Container size="xl" className="grid gap-10 py-14 md:grid-cols-[1.5fr_1fr_1fr_1fr]">
        <div>
          <Logo />
          <p className="mt-4 max-w-xs text-sm leading-relaxed text-muted-foreground">
            Find your X factor. Discover the logic behind every &ldquo;why&rdquo;
            and build strong analytical thinking with guidance from IITians.
          </p>
        </div>
        {COLUMNS.map(({ title, links }) => (
          <div key={title}>
            <h3 className="text-sm font-semibold">{title}</h3>
            <ul className="mt-4 space-y-2.5 text-sm">
              {links.map(({ label, href }) => (
                <li key={label}>
                  {href ? (
                    <Link
                      href={href}
                      className="text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {label}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">{label}</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </Container>
      <div className="border-t border-border">
        <Container size="xl" className="flex flex-col justify-between gap-2 py-5 text-sm text-muted-foreground md:flex-row">
          <p>© {new Date().getFullYear()} LogixAI. All rights reserved.</p>
          <p>Built by IITians in India.</p>
        </Container>
      </div>
    </footer>
  );
}
