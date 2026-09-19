import PageWrapper from "@/components/page-wrapper";

import { AddCompetitionSuggestion } from "@/modules/competitions/components/suggestion/add-competition-suggestion";

export default function NewCompetitionSuggestionPage() {
  return (
    <PageWrapper
      breadcrumbs={[
        {
          label: "Competitions",
          href: "/competitions",
        },
        {
          label: "Suggest a Competition",
          href: "#",
        },
      ]}
    >
      <div className="space-y-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            Suggest a Competition
          </h1>

          <p className="mt-2 text-muted-foreground">
            Help us discover competitions worth sharing
            with the Kizunia community.
          </p>
        </div>

        <AddCompetitionSuggestion />
      </div>
    </PageWrapper>
  );
}