import { ScrollReveal } from "@/components/marketing/scroll-reveal";
import { FunnelIcon } from "@phosphor-icons/react/dist/ssr/Funnel";
import { MapPinIcon } from "@phosphor-icons/react/dist/ssr/MapPin";
import { UsersThreeIcon } from "@phosphor-icons/react/dist/ssr/UsersThree";

const FACETS = [
  {
    icon: FunnelIcon,
    title: "Filter by what fits you",
    body: "Category, technology, team size, mode, and eligibility, not just a keyword search over a long list.",
  },
  {
    icon: MapPinIcon,
    title: "Location and format aware",
    body: "Online, in person, or hybrid. Filter to what you can actually attend, wherever you are.",
  },
  {
    icon: UsersThreeIcon,
    title: "Built around relevance",
    body: "The goal isn't more listings. It's fewer, better matched ones, so you spend less time searching.",
  },
];

export function FilteringSection() {
  return (
    <section className="mx-auto w-full max-w-5xl px-6 py-24">
      <div className="grid gap-12 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] sm:items-start">
        <ScrollReveal>
          <div className="max-w-170">
            <p className="text-sm font-medium text-primary">Filtering</p>
            <h2 className="mt-2 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
              Not every competition is for you. Filtering finds the ones that are.
            </h2>
            <p className="mt-4 text-pretty text-base leading-relaxed text-muted-foreground">
              A long list of hackathons isn&apos;t useful on its own. The
              value is in narrowing it down to what actually matches what
              you&apos;re looking for.
            </p>
          </div>
        </ScrollReveal>

        <div className="flex flex-col gap-6">
          {FACETS.map((facet, i) => (
            <ScrollReveal key={facet.title} delay={i * 0.1}>
              <div className="flex gap-4 rounded-xl border border-border bg-card p-5">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-secondary text-secondary-foreground">
                  <facet.icon className="size-4" weight="bold" />
                </div>
                <div>
                  <h3 className="text-base font-medium">{facet.title}</h3>
                  <p className="mt-1 text-pretty text-sm leading-relaxed text-muted-foreground">
                    {facet.body}
                  </p>
                </div>
              </div>
            </ScrollReveal>
          ))}
        </div>
      </div>
    </section>
  );
}
