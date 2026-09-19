import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/legal-page";
import { LegalSection } from "@/components/legal/legal-section";
import { legalConfig, termsSections } from "@/constants/legal";

export const metadata: Metadata = {
  title: "Terms of Service | Kizunia",
  description: "The Terms of Service for using Kizunia.",
};

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service" description="The rules and responsibilities that apply when you use Kizunia." sections={termsSections}>
      {termsSections.map((section, index) => <LegalSection key={section.id} id={section.id} number={index + 1} title={section.title}>{section.content}</LegalSection>)}
      <p className="border-t border-border/70 pt-8 text-sm text-muted-foreground">Last updated: {legalConfig.lastUpdated}</p>
    </LegalPage>
  );
}
