import Link from "next/link";
import { TriangleAlertIcon } from "lucide-react";

import { PlatformAction } from "@/authorization/platform/actions";
import { PlatformAuthorizer } from "@/authorization/platform/authorizer";
import type { StrictAuthorizationActor } from "@/authorization";
import PageWrapper from "@/components/page-wrapper";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { SessionService } from "@/lib/auth/session";
import { AppError, AuthenticationError } from "@/lib/errors";
import {
  activeFilterCount,
  buildSearchHref,
  clearAllFiltersPatch,
  type RawSearchParams,
} from "@/lib/search";
import { SearchPagination } from "@/lib/search/react";

import { CompetitionLifecycleService } from "@/modules/competitions/backend/lifecycle.service";
import { CompetitionFilters } from "@/modules/competitions/components/discovery/competition-filters";
import { LIFECYCLE_FILTER_SPECS } from "@/modules/competitions/search/ui";
import { TaxonomyService } from "@/modules/taxonomy";

import { LifecyclePreviewTable } from "./_components/lifecycle-preview-table";

const PATHNAME = "/admin/competitions/lifecycle";

interface Props {
  searchParams: Promise<RawSearchParams>;
}

/**
 * Admin competition lifecycle console.
 *
 * A Server Component, same shape as `/admin/competitions`: the preview runs
 * here against the URL, filtered with the shared Competition filter
 * architecture (`scope="lifecycle"`), and only the table's interactive parts
 * (row exclusion, apply) are a client component underneath it. Every row
 * shown here is already known to be an *actionable* change — see
 * `CompetitionLifecycleService.preview`'s doc comment on why pagination is
 * computed over the changed set rather than the raw filter match.
 *
 * Authorizes independently of the page-level guard, exactly like the
 * ordinary admin competitions page: `MANAGE_COMPETITION_LIFECYCLE` is
 * checked again by the preview/apply API routes themselves.
 */
export default async function AdminCompetitionsLifecyclePage({
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
    PlatformAction.MANAGE_COMPETITION_LIFECYCLE,
  );

  const [previewOutcome, categories, technologies] = await Promise.allSettled([
    CompetitionLifecycleService.preview(params),
    TaxonomyService.listCategories({
      limit: 200,
      includeEmpty: false,
      entity: "competition",
    }),
    TaxonomyService.listTechnologies({
      limit: 200,
      includeEmpty: false,
      entity: "competition",
    }),
  ]);

  const optionsMap = {
    categories: categories.status === "fulfilled" ? categories.value : [],
    technologies:
      technologies.status === "fulfilled" ? technologies.value : [],
  };

  if (previewOutcome.status === "rejected") {
    return (
      <LifecycleShell optionsMap={optionsMap}>
        <PreviewFailure error={previewOutcome.reason} params={params} />
      </LifecycleShell>
    );
  }

  const { items, pagination } = previewOutcome.value;

  return (
    <LifecycleShell optionsMap={optionsMap} total={pagination.total}>
      {items.length === 0 ? (
        <EmptyResults params={params} />
      ) : (
        // Remounted (via `key`) whenever the filters/sort/page change, the
        // same reason `AdminCompetitionsTable` is — so row exclusion never
        // survives past the search that produced the rows it applied to.
        <LifecyclePreviewTable key={JSON.stringify(params)} rows={items} />
      )}

      <SearchPagination
        pagination={pagination}
        params={params}
        pathname={PATHNAME}
        className="pt-2"
      />
    </LifecycleShell>
  );
}

function LifecycleShell({
  optionsMap,
  total,
  children,
}: {
  optionsMap: {
    categories: { value: string; label: string; count: number }[];
    technologies: { value: string; label: string; count: number }[];
  };
  total?: number;
  children: React.ReactNode;
}) {
  return (
    <PageWrapper
      breadcrumbs={[
        { label: "Competitions", href: "/admin/competitions" },
        { label: "Lifecycle", href: PATHNAME },
      ]}
    >
      <div className="space-y-2">
        <h1 className="text-4xl font-bold tracking-tight">
          Competition lifecycle
        </h1>
        <p className="max-w-2xl text-muted-foreground">
          Competitions whose status a nightly automatic sweep would change,
          based on their lifecycle dates. Nothing here has been applied yet —
          review the proposed changes, exclude any you don&apos;t want, and
          confirm. A competition with automatic updates turned off never
          appears in this list.
        </p>
      </div>

      <CompetitionFilters optionsMap={optionsMap} scope="lifecycle" />

      {total !== undefined && (
        <p
          className="text-sm text-muted-foreground"
          role="status"
          aria-live="polite"
        >
          {total === 1
            ? "1 competition would change"
            : `${total} competitions would change`}
        </p>
      )}

      {children}
    </PageWrapper>
  );
}

function PreviewFailure({
  error,
  params,
}: {
  error: unknown;
  params: RawSearchParams;
}) {
  const isKnown = error instanceof AppError;

  const message = isKnown
    ? error.message
    : "Something went wrong while loading the lifecycle preview.";

  if (!isKnown) {
    console.error("Competition lifecycle preview failed.", error);
  }

  return (
    <Alert variant="destructive">
      <TriangleAlertIcon />
      <AlertTitle>{message}</AlertTitle>
      <AlertDescription className="gap-3">
        <p>Your filters are still applied. Try again, or clear them.</p>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild size="sm" variant="outline">
            <Link href="/admin/competitions/lifecycle">Try again</Link>
          </Button>
          <Button asChild size="sm" variant="ghost">
            <Link
              href={buildSearchHref(
                "/admin/competitions/lifecycle",
                params,
                clearAllFiltersPatch(LIFECYCLE_FILTER_SPECS),
              )}
            >
              Clear filters
            </Link>
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}

function EmptyResults({ params }: { params: RawSearchParams }) {
  const clearPatch = clearAllFiltersPatch(LIFECYCLE_FILTER_SPECS);
  const hasFilters = activeFilterCount(LIFECYCLE_FILTER_SPECS, params) > 0;

  return (
    <Empty className="border">
      <EmptyHeader>
        <EmptyTitle>
          {hasFilters
            ? "No competitions would change under these filters"
            : "Nothing to update"}
        </EmptyTitle>
        <EmptyDescription>
          {hasFilters
            ? "Every matching competition already has the status its dates imply, or has automatic updates turned off. Try removing a filter."
            : "Every competition's status already matches what its lifecycle dates imply."}
        </EmptyDescription>
      </EmptyHeader>

      {hasFilters && (
        <EmptyContent>
          <Button asChild variant="outline">
            <Link href={buildSearchHref("/admin/competitions/lifecycle", params, clearPatch)}>
              Clear all filters
            </Link>
          </Button>
        </EmptyContent>
      )}
    </Empty>
  );
}
