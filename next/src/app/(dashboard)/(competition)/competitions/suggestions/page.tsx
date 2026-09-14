import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

import PageWrapper from "@/components/page-wrapper";

import { CompetitionSuggestionService } from "@/modules/competitions/backend/suggestion/service";
import { SessionService } from "@/lib/auth/index";
import { Metadata } from "next/types";

function formatStatus(status: string) {
  return status.toLowerCase().replaceAll("_", " ");
}

export const metadata: Metadata = {
  title: "Suggestions",
  description: "Competitions you have suggested to Kizunia.",
};

export default async function MySuggestionsPage() {
  const actor = await SessionService.getStrictActor();

  const suggestions = await CompetitionSuggestionService.findMine({
    actor,
  });

  return (
    <PageWrapper
      breadcrumbs={[
        {
          label: "Competitions",
          href: "/competitions",
        },
        {
          label: "My Suggestions",
          href: "#",
        },
      ]}
    >
      <div className="space-y-8">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">
              My Suggestions
            </h1>

            <p className="mt-2 text-muted-foreground">
              Competitions you have suggested to Kizunia.
            </p>
          </div>

          <Button asChild>
            <Link href="/competitions/suggestions/new">
              Suggest a Competition
            </Link>
          </Button>
        </div>

        {suggestions.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <h2 className="text-lg font-semibold">No suggestions yet</h2>

              <p className="mt-2 text-sm text-muted-foreground">
                Know a competition that should be on Kizunia?
              </p>

              <Button asChild className="mt-6">
                <Link href="/competitions/suggestions/new">
                  Suggest a Competition
                </Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4">
            {suggestions.map((suggestion) => (
              <Link
                key={suggestion.id}
                href={`/competitions/suggestions/${suggestion.id}`}
              >
                <Card className="transition-colors hover:bg-muted/50">
                  <CardHeader>
                    <div className="flex items-start justify-between gap-4">
                      <CardTitle>{suggestion.suggestionTitle}</CardTitle>

                      <Badge>{formatStatus(suggestion.status)}</Badge>
                    </div>
                  </CardHeader>

                  <CardContent>
                    <p className="text-sm text-muted-foreground">
                      {suggestion.submittedAt
                        ? `Submitted ${new Date(
                            suggestion.submittedAt,
                          ).toLocaleDateString()}`
                        : "Not submitted"}
                    </p>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </PageWrapper>
  );
}
