import { ScrollReveal } from "@/components/marketing/scroll-reveal";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/dist/ssr/MagnifyingGlass";
import { SlidersIcon } from "@phosphor-icons/react/dist/ssr/Sliders";
import { BellRingingIcon } from "@phosphor-icons/react/dist/ssr/BellRinging";

const STEPS = [
  {
    number: "01",
    icon: MagnifyingGlassIcon,
    title: "Discover",
    body: "Competitions from across different platforms and communities, brought into one discovery experience.",
  },
  {
    number: "02",
    icon: SlidersIcon,
    title: "Filter",
    body: "Narrow a large set of opportunities down to the ones that actually fit what you're looking for.",
  },
  {
    number: "03",
    icon: BellRingingIcon,
    title: "Stay updated",
    body: "Keep track of what matters to you and get notified, instead of searching from scratch every time.",
  },
];

export function HowItWorks() {
  return (
    <section id="how-it-works" className="mx-auto w-full max-w-5xl px-6 py-24">
      <ScrollReveal>
        <div className="max-w-170">
          <p className="text-sm font-medium text-primary">How it works</p>
          <h2 className="mt-2 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
            One loop: discover, filter, stay updated.
          </h2>
        </div>
      </ScrollReveal>

      <div className="mt-14 grid gap-10 sm:grid-cols-3 sm:gap-8">
        {STEPS.map((step, i) => (
          <ScrollReveal key={step.title} delay={i * 0.12}>
            <div className="relative flex flex-col gap-4 border-t border-border pt-6">
              <span className="font-mono text-xs text-muted-foreground">
                {step.number}
              </span>
              <div className="flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <step.icon className="size-5" weight="bold" />
              </div>
              <h3 className="text-lg font-medium">{step.title}</h3>
              <p className="text-pretty text-sm leading-relaxed text-muted-foreground">
                {step.body}
              </p>
            </div>
          </ScrollReveal>
        ))}
      </div>
    </section>
  );
}
