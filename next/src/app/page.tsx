import type { Metadata } from "next";
import { SiteNav } from "@/components/marketing/site-nav";
import { Hero } from "@/components/marketing/hero";
import { ProblemSection } from "@/components/marketing/problem-section";
import { TaglineReveal } from "@/components/marketing/tagline-reveal";
import { HowItWorks } from "@/components/marketing/how-it-works";
import { FilteringSection } from "@/components/marketing/filtering-section";
import { BeyondSection } from "@/components/marketing/beyond-section";
import { FaqSection } from "@/components/marketing/faq-section";
import { FinalCta } from "@/components/marketing/final-cta";
import { SiteFooter } from "@/components/marketing/site-footer";

export const metadata: Metadata = {
  title: "Kizunia — Discover competitions built around you",
  description:
    "Hackathons and competitions are scattered everywhere. Kizunia brings them into one place, filtered to what actually fits you, so you never miss the ones that matter.",
  openGraph: {
    title: "Kizunia — Discover competitions built around you",
    description:
      "Hackathons and competitions are scattered everywhere. Kizunia brings them into one place, filtered to what actually fits you, so you never miss the ones that matter.",
    type: "website",
  },
};

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <a
        href="#main-content"
        className="sr-only rounded-full bg-primary px-4 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-60"
      >
        Skip to content
      </a>
      <SiteNav />
      <main id="main-content" className="flex-1">
        <Hero />
        <ProblemSection />
        <TaglineReveal />
        <HowItWorks />
        <FilteringSection />
        <BeyondSection />
        <FaqSection />
        <FinalCta />
      </main>
      <SiteFooter />
    </div>
  );
}
