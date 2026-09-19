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

import { CompetitionService } from "@/modules/competitions/backend/service";
import { CompetitionFilters } from "@/modules/competitions/components/discovery/competition-filters";
import { ADMIN_FILTER_SPECS } from "@/modules/competitions/search/ui";
import { TaxonomyService } from "@/modules/taxonomy";

import { AdminCompetitionsTable } from "./_components/admin-competitions-table";
import { AdminSummaryStrip } from "./_components/admin-summary-strip";

const PATHNAME = "/admin/competitions";

interface Props {
  searchParams: Promise<RawSearchParams>;
}

/**
 * Admin competition management.
 *
 * A Server Component, same as the public listing: the search runs here
 * against the URL, and only the table's interactive parts (selection,
 * inline edit, row menus) are client components underneath it. Reuses the
 * exact same filter/sort/pagination architecture the public page uses, with
 * `scope="admin"` adding the Record state filter and letting `deletedAt`
 * become visible on request — see `plan.ts`'s `deletionClauses`.
 */
export default async function AdminCompetitionsPage({ searchParams }: Props) {
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
    PlatformAction.VIEW_ALL_COMPETITIONS,
  );

  // The summary strip describes the whole admin universe and does not
  // depend on the current filters, so it is fetched alongside the (filtered)
  // table query rather than derived from it. Taxonomy options populate the
  // category/technology pickers, which `ADMIN_FILTER_SPECS` inherits from the
  // shared registry — an outage there costs the pickers their options, not
  // the page, same reasoning as the public listing.
  const [searchOutcome, summary, categories, technologies] =
    await Promise.allSettled([
      CompetitionService.searchAdmin(strictActor, params),
      CompetitionService.getAdminSummary(),
      TaxonomyService.listCategories({ limit: 200, includeEmpty: false, entity: "competition" }),
      TaxonomyService.listTechnologies({ limit: 200, includeEmpty: false, entity: "competition" }),
    ]);

  const summaryValue =
    summary.status === "fulfilled"
      ? summary.value
      : { total: 0, active: 0, deleted: 0, upcoming: 0 };

  const optionsMap = {
    categories: categories.status === "fulfilled" ? categories.value : [],
    technologies:
      technologies.status === "fulfilled" ? technologies.value : [],
  };

  if (searchOutcome.status === "rejected") {
    return (
      <AdminShell summary={summaryValue} params={params} optionsMap={optionsMap}>
        <SearchFailure error={searchOutcome.reason} params={params} />
      </AdminShell>
    );
  }

  const { items, pagination } = searchOutcome.value;

  return (
    <AdminShell
      summary={summaryValue}
      params={params}
      optionsMap={optionsMap}
      total={pagination.total}
    >
      {items.length === 0 ? (
        <EmptyResults params={params} />
      ) : (
        // Remounts the table — and resets its local selection state — every
        // time the filters, sort or page change, since the query string is
        // exactly what changed to produce a new `items` array.
        <AdminCompetitionsTable
          key={JSON.stringify(params)}
          competitions={items}
        />
      )}

      <SearchPagination
        pagination={pagination}
        params={params}
        pathname={PATHNAME}
        className="pt-2"
      />
    </AdminShell>
  );
}

function AdminShell({
  summary,
  params,
  optionsMap,
  total,
  children,
}: {
  summary: { total: number; active: number; deleted: number; upcoming: number };
  params: RawSearchParams;
  optionsMap: {
    categories: { value: string; label: string; count: number }[];
    technologies: { value: string; label: string; count: number }[];
  };
  total?: number;
  children: React.ReactNode;
}) {
  return (
    <PageWrapper breadcrumbs={[{ label: "Competitions", href: PATHNAME }]}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <h1 className="text-4xl font-bold tracking-tight">Competitions</h1>
          <p className="max-w-2xl text-muted-foreground">
            Every competition on the platform, regardless of visibility.
          </p>
        </div>

        <Button asChild variant="outline" size="sm">
          <Link href="/admin/competitions/lifecycle">Update statuses</Link>
        </Button>
      </div>

      <AdminSummaryStrip summary={summary} params={params} />

      <CompetitionFilters optionsMap={optionsMap} scope="admin" />

      {total !== undefined && (
        <p
          className="text-sm text-muted-foreground"
          role="status"
          aria-live="polite"
        >
          {total === 1 ? "1 competition" : `${total} competitions`}
        </p>
      )}

      {children}
    </PageWrapper>
  );
}

function SearchFailure({
  error,
  params,
}: {
  error: unknown;
  params: RawSearchParams;
}) {
  const isKnown = error instanceof AppError;

  const message = isKnown
    ? error.message
    : "Something went wrong while loading competitions.";

  if (!isKnown) {
    console.error("Admin competition search failed.", error);
  }

  return (
    <Alert variant="destructive">
      <TriangleAlertIcon />
      <AlertTitle>{message}</AlertTitle>
      <AlertDescription className="gap-3">
        <p>Your filters are still applied. Try again, or clear them.</p>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild size="sm" variant="outline">
            <Link href={PATHNAME}>Try again</Link>
          </Button>
          <Button asChild size="sm" variant="ghost">
            <Link
              href={buildSearchHref(
                PATHNAME,
                params,
                clearAllFiltersPatch(ADMIN_FILTER_SPECS),
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
  const clearPatch = clearAllFiltersPatch(ADMIN_FILTER_SPECS);

  // Asked of the filters themselves rather than of the clear patch's keys:
  // that patch also names `page` and the preset marker, neither of which
  // narrows anything.
  const hasFilters = activeFilterCount(ADMIN_FILTER_SPECS, params) > 0;

  return (
    <Empty className="border">
      <EmptyHeader>
        <EmptyTitle>
          {hasFilters ? "No competitions match these filters" : "No competitions yet"}
        </EmptyTitle>
        <EmptyDescription>
          {hasFilters
            ? "Try removing a filter, or check Record state — it may be hiding what you're looking for."
            : "Nothing has been created yet."}
        </EmptyDescription>
      </EmptyHeader>

      {hasFilters && (
        <EmptyContent>
          <Button asChild variant="outline">
            <Link href={buildSearchHref(PATHNAME, params, clearPatch)}>
              Clear all filters
            </Link>
          </Button>
        </EmptyContent>
      )}
    </Empty>
  );
}
