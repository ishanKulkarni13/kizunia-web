import { ScrollReveal } from "@/components/marketing/scroll-reveal";
import { StackIcon } from "@phosphor-icons/react/dist/ssr/Stack";
import { EyeClosedIcon } from "@phosphor-icons/react/dist/ssr/EyeClosed";
import { TargetIcon } from "@phosphor-icons/react/dist/ssr/Target";

const POINTS = [
  {
    icon: StackIcon,
    title: "Scattered everywhere",
    body: "Hackathons and competitions live across dozens of platforms, communities, and organizer pages. There is no single place to look.",
  },
  {
    icon: EyeClosedIcon,
    title: "Easy to miss",
    body: "Because they are scattered, you find out too late, or not at all. Somewhere, a competition you would have wanted was posted, and you never saw it.",
  },
  {
    icon: TargetIcon,
    title: "Hard to narrow down",
    body: "Even when you do find listings, most are not relevant to you. Sorting through everything to find what actually fits takes real effort.",
  },
];

export function ProblemSection() {
  return (
    <section className="mx-auto w-full max-w-5xl px-6 py-24">
      <ScrollReveal>
        <h2 className="max-w-170 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
          Opportunities exist. Finding them is the hard part.
        </h2>
      </ScrollReveal>

      <div className="mt-12 grid gap-8 sm:grid-cols-3">
        {POINTS.map((point, i) => (
          <ScrollReveal key={point.title} delay={i * 0.1}>
            <div className="flex flex-col gap-3">
              <div className="flex size-10 items-center justify-center rounded-lg bg-secondary text-secondary-foreground">
                <point.icon className="size-5" weight="bold" />
              </div>
              <h3 className="text-lg font-medium">{point.title}</h3>
              <p className="text-pretty text-sm leading-relaxed text-muted-foreground">
                {point.body}
              </p>
            </div>
          </ScrollReveal>
        ))}
      </div>
    </section>
  );
}
