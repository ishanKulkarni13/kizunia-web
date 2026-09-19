import Link from "next/link";
import { ScrollReveal } from "@/components/marketing/scroll-reveal";
import { Button } from "@/components/ui/button";

export function FinalCta() {
  return (
    <section className="mx-auto w-full max-w-5xl px-6 py-24">
      <ScrollReveal>
        <div className="flex flex-col items-center rounded-2xl border border-border bg-card px-6 py-16 text-center sm:py-20">
          <h2 className="max-w-170 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
            Find your next competition. Don&apos;t miss it.
          </h2>
          <p className="mt-4 max-w-140 text-pretty text-base text-muted-foreground sm:text-lg">
            Discover competitions in one place and stay updated on the
            opportunities you care about.
          </p>
          <Button asChild size="lg" className="mt-8 rounded-full px-6 text-base">
            <Link href="/competitions">Explore competitions</Link>
          </Button>
        </div>
      </ScrollReveal>
    </section>
  );
}
