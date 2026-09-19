import { notFound } from "next/navigation";

import PageWrapper from "@/components/page-wrapper";

import { CompetitionSuggestionService } from "@/modules/competitions/backend/suggestion/service";
import { SessionService } from "@/lib/auth/index";
import { SuggestionDetailView } from "@/modules/competitions/components/suggestion/suggestion-detail-view";

interface Props {
  params: Promise<{
    id: string;
  }>;
}

export default async function CompetitionSuggestionPage({
  params,
}: Props) {
  const { id } = await params;

    const actor =  await SessionService.getStrictActor();

  const suggestion =
    await CompetitionSuggestionService.findById({
      actor,
      id,
    });

  if (!suggestion) {
    notFound();
  }

  return (
    <PageWrapper
      breadcrumbs={[
        {
          label: "Competitions",
          href: "/competitions",
        },
        {
          label: "My Suggestions",
          href: "/competitions/suggestions",
        },
        {
          label: suggestion.suggestionTitle,
          href: "#",
        },
      ]}
    >
      <SuggestionDetailView suggestion={suggestion} />
    </PageWrapper>
  );
}