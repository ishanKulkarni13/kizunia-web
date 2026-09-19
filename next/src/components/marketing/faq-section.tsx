import { ScrollReveal } from "@/components/marketing/scroll-reveal";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

const FAQS = [
  {
    q: "Does Kizunia organize hackathons?",
    a: "No. Kizunia is a discovery layer, not an organizer platform. Competitions are hosted by the teams and communities that run them. We help you find and track the ones already out there.",
  },
  {
    q: "Where do the listed competitions come from?",
    a: "We pull together competitions published across different platforms, organizer sites, and communities, so you don't have to check each one separately.",
  },
  {
    q: "How is this different from just searching Google?",
    a: "A search gets you scattered results you have to revisit. Kizunia keeps competitions in one filterable place and notifies you when something relevant comes up, instead of you having to look again.",
  },
  {
    q: "How does filtering work?",
    a: "You can narrow competitions by category, technology, team size, mode, location, and eligibility, so what you see is closer to what you'd actually apply for.",
  },
  {
    q: "Do I need an account to browse competitions?",
    a: "No. You can browse and filter competitions without signing up. An account is only needed if you want notifications, a portfolio, or to showcase a project.",
  },
  {
    q: "Is Kizunia free to use?",
    a: "Yes. Discovering and filtering competitions is free.",
  },
  {
    q: "Can I submit a competition that isn't listed?",
    a: "Yes, you can suggest a competition for us to add. We review suggestions before they go live.",
  },
];

export function FaqSection() {
  return (
    <section id="faq" className="mx-auto w-full max-w-3xl px-6 py-24">
      <ScrollReveal>
        <h2 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
          Questions, answered
        </h2>
      </ScrollReveal>

      <ScrollReveal delay={0.1}>
        <Accordion type="single" collapsible className="mt-10">
          {FAQS.map((item) => (
            <AccordionItem key={item.q} value={item.q}>
              <AccordionTrigger className="py-4 text-base">
                {item.q}
              </AccordionTrigger>
              <AccordionContent className="text-base text-muted-foreground">
                {item.a}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </ScrollReveal>
    </section>
  );
}
