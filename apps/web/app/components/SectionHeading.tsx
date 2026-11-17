import { Eyebrow, cn } from "@logixai/ui";

/** Eyebrow + title + intro used at the top of every marketing section. */
export default function SectionHeading({
  eyebrow,
  title,
  children,
  align = "left",
  className,
}: {
  eyebrow: string;
  title: React.ReactNode;
  children?: React.ReactNode;
  align?: "left" | "center";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "max-w-2xl",
        align === "center" && "mx-auto text-center",
        className,
      )}
    >
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2 className="mt-2 text-3xl font-bold text-foreground md:text-4xl">
        {title}
      </h2>
      {children ? (
        <p className="mt-4 text-base leading-relaxed text-muted-foreground md:text-lg">
          {children}
        </p>
      ) : null}
    </div>
  );
}
