import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/legal-page";
import { LegalSection } from "@/components/legal/legal-section";
import { legalConfig, privacySections } from "@/constants/legal";

export const metadata: Metadata = {
  title: "Privacy Policy | Kizunia",
  description: "How Kizunia handles information in connection with its services.",
};

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" description="A clear overview of the information Kizunia handles and the choices available to you." sections={privacySections}>
      {privacySections.map((section, index) => <LegalSection key={section.id} id={section.id} number={index + 1} title={section.title}>{section.content}</LegalSection>)}
      <p className="border-t border-border/70 pt-8 text-sm text-muted-foreground">Last updated: {legalConfig.lastUpdated}</p>
    </LegalPage>
  );
}
