import { PlatformAction } from "@/authorization/platform/actions";
import { PlatformAuthorizer } from "@/authorization/platform/authorizer";
import type { StrictAuthorizationActor } from "@/authorization";
import PageWrapper from "@/components/page-wrapper";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { SessionService } from "@/lib/auth/session";
import { AuthenticationError } from "@/lib/errors";
import type { RawSearchParams } from "@/lib/search";
import { SearchPagination } from "@/lib/search/react";

import { CompetitionSuggestionService } from "@/modules/competitions/backend/suggestion/service";

import { AdminSuggestionsTable } from "./_components/admin-suggestions-table";
import { SuggestionStatusFilter } from "./_components/suggestion-status-filter";

const PATHNAME = "/admin/competition-suggestions";

interface Props {
  searchParams: Promise<RawSearchParams>;
}

/**
 * Admin Competition Suggestion review queue.
 *
 * Server Component, same shape as `admin/competitions/page.tsx`: the
 * authorization check happens here (independently of any client-side
 * button state) and the search runs directly against the service — no
 * fetch round-trip. Deliberately simpler than the Competition admin page:
 * no summary strip, no taxonomy pickers, since this list has one real
 * filter (status).
 */
export default async function AdminCompetitionSuggestionsPage({
  searchParams,
}: Props) {
  const params = await searchParams;

  const actor = await SessionService.getActor();

  if (!actor || !actor.role || !!actor.banned || !actor.id) {
    throw new AuthenticationError({
      code: "UNAUTHORIZED",
      message: "You are not authorized to access this page.",
      status: 401,
    });
  }

  const strictActor: StrictAuthorizationActor = {
    id: actor.id,
    role: actor.role,
    banned: actor.banned ?? true,
  };

  PlatformAuthorizer.can(
    { actor: strictActor },
    PlatformAction.VIEW_COMPETITION_SUGGESTIONS,
  );

  const { items, pagination } = await CompetitionSuggestionService.searchForReview({
    actor: strictActor,
    params,
  });

  return (
    <PageWrapper
      breadcrumbs={[{ label: "Competition Suggestions", href: PATHNAME }]}
    >
      <div className="space-y-2">
        <h1 className="text-4xl font-bold tracking-tight">
          Competition Suggestions
        </h1>
        <p className="max-w-2xl text-muted-foreground">
          Community-submitted suggestions awaiting review. Drafts are hidden
          by default — use the Draft filter to find forgotten ones.
        </p>
      </div>

      <SuggestionStatusFilter pathname={PATHNAME} params={params} />

      <p
        className="text-sm text-muted-foreground"
        role="status"
        aria-live="polite"
      >
        {pagination.total === 1
          ? "1 suggestion"
          : `${pagination.total} suggestions`}
      </p>

      {items.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>No suggestions here</EmptyTitle>
            <EmptyDescription>
              Nothing matches this filter right now.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <AdminSuggestionsTable suggestions={items} />
      )}

      <SearchPagination
        pagination={pagination}
        params={params}
        pathname={PATHNAME}
        className="pt-2"
      />
    </PageWrapper>
  );
}
