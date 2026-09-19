import type { ReactNode } from "react";

type LegalSectionProps = {
  id: string;
  number: number;
  title: string;
  children: ReactNode;
};

export function LegalSection({ id, number, title, children }: LegalSectionProps) {
  return (
    <section id={id} className="scroll-mt-8 border-t border-border/70 pt-10 first:border-t-0 first:pt-0">
      <p className="mb-3 font-mono text-xs font-medium tracking-[0.18em] text-primary">
        {String(number).padStart(2, "0")}
      </p>
      <h2 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">{title}</h2>
      <div className="mt-5 space-y-4 text-[1.02rem] leading-8 text-muted-foreground [&_a]:font-medium [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-4 [&_a]:hover:text-foreground [&_li]:pl-1 [&_ol]:list-decimal [&_ol]:space-y-2 [&_ol]:pl-6 [&_p]:max-w-3xl [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-6">
        {children}
      </div>
    </section>
  );
}
