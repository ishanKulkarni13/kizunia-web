import Link from "next/link";
import { MapPinOffIcon, SearchXIcon, TriangleAlertIcon } from "lucide-react";

import PageWrapper from "@/components/page-wrapper";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { AppError } from "@/lib/errors";
import type { RawSearchParams } from "@/lib/search";
import {
  activeFilterCount,
  buildSearchHref,
  clearAllFiltersPatch,
} from "@/lib/search";
import { SearchPagination } from "@/lib/search/react";

import { CompetitionService } from "@/modules/competitions/backend/service";
import CompetitionsCards from "@/modules/competitions/components/allCompititions/CompetitionsCards";
import { CompetitionFilters } from "@/modules/competitions/components/discovery/competition-filters";
import { COMPETITION_FILTER_SPECS } from "@/modules/competitions/search/ui";
import { TaxonomyService } from "@/modules/taxonomy";
import { Metadata } from "next/types";

const PATHNAME = "/competitions";

interface Props {
  searchParams: Promise<RawSearchParams>;
}

export const metadata: Metadata = {
  title: "Competitions",
  description:
    "Discover hackathons, coding contests, innovation challenges and open opportunities from colleges and organizations.",
   alternates: {
    canonical: "/competitions",
  },
  
    openGraph: {
    title: "Competitions",
    description:
      "Discover hackathons, coding contests, innovation challenges and open opportunities from colleges and organizations.",
  },
  twitter: {
    title: "Competitions",
    description:
      "Discover hackathons, coding contests, innovation challenges and open opportunities from colleges and organizations.",
  },
};

/**
 * Competition discovery.
 *
 * Stays a Server Component. The search runs here, against the URL, so results
 * are rendered rather than fetched — which is what makes a filtered listing
 * shareable, indexable and correct on first paint. Only the controls are
 * client components, and they do nothing but write back to the URL this page
 * reads.
 *
 * Taxonomy options are loaded here too, in parallel with the search. They
 * populate the category and technology pickers and supply the labels the
 * active-filter chips render, so neither needs a client-side request.
 */
export default async function CompetitionsPage({ searchParams }: Props) {
  const params = await searchParams;

  // Options load independently of the search and must not be able to fail it:
  // a taxonomy outage should cost the pickers their labels, not take down
  // browsing. Settled rather than awaited together for exactly that reason.
  const [searchOutcome, categories, technologies] = await Promise.allSettled([
    CompetitionService.search(params),
    TaxonomyService.listCategories({ limit: 200, includeEmpty: false, entity: "competition" }),
    TaxonomyService.listTechnologies({ limit: 200, includeEmpty: false, entity: "competition" }),
  ]);

  const optionsMap = {
    categories: categories.status === "fulfilled" ? categories.value : [],
    technologies: technologies.status === "fulfilled" ? technologies.value : [],
  };

  if (searchOutcome.status === "rejected") {
    return (
      <CompetitionsShell optionsMap={optionsMap}>
        <SearchFailure error={searchOutcome.reason} params={params} />
      </CompetitionsShell>
    );
  }

  const { items, pagination } = searchOutcome.value;

  return (
    <CompetitionsShell optionsMap={optionsMap} total={pagination.total}>
      {items.length === 0 ? (
        <EmptyResults params={params} />
      ) : (
        <CompetitionsCards competitions={items} />
      )}

      <SearchPagination
        pagination={pagination}
        params={params}
        pathname={PATHNAME}
        className="mx-auto w-full max-w-4xl pt-2"
      />
    </CompetitionsShell>
  );
}

/**
 * Page chrome shared by every outcome.
 *
 * The filter bar renders even when the search failed. Losing the controls
 * along with the results would leave someone stranded on a broken page with no
 * way to change the query that broke it — which is most likely exactly what
 * they need to do.
 */
function CompetitionsShell({
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
    <PageWrapper breadcrumbs={[{ label: "Competitions", href: PATHNAME }]}>
      <div className="space-y-2">
        <h1 className="text-4xl font-bold tracking-tight">Competitions</h1>

        <p className="max-w-2xl text-muted-foreground">
          Discover hackathons, coding contests, innovation challenges and open
          opportunities from colleges and organizations.
        </p>
      </div>

      <CompetitionFilters optionsMap={optionsMap} scope="public" />

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

/**
 * A search that could not be completed.
 *
 * Distinguished from an empty result deliberately, because the two mean
 * opposite things. A location lookup that timed out is not evidence that
 * nowhere has competitions, and presenting it as an empty list would tell the
 * person something false.
 *
 * Only a recognised application error's message is shown. An unexpected error
 * gets a generic line, because its message is written for a log, not for a
 * person, and may name internals.
 */
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
    console.error("Competition search failed.", error);
  }

  return (
    <Alert variant="destructive">
      <TriangleAlertIcon />

      <AlertTitle>{message}</AlertTitle>

      <AlertDescription className="gap-3">
        <p>
          Your filters are still applied. Try again, or clear them to browse
          everything.
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <Button asChild size="sm" variant="outline">
            {/* A plain link so the retry is a fresh server render, not a
                client-side replay of the request that just failed. */}
            <Link href={buildSearchHref(PATHNAME, params)}>Try again</Link>
          </Button>

          <Button asChild size="sm" variant="ghost">
            <Link
              href={buildSearchHref(
                PATHNAME,
                params,
                clearAllFiltersPatch(COMPETITION_FILTER_SPECS),
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

/**
 * A search that worked and matched nothing.
 *
 * The copy distinguishes an over-narrow search from an empty platform, because
 * the two need different things from the reader: one is fixed by relaxing a
 * filter, the other cannot be fixed by them at all.
 */
function EmptyResults({ params }: { params: RawSearchParams }) {
  const clearPatch = clearAllFiltersPatch(COMPETITION_FILTER_SPECS);

  // Asked of the filters themselves rather than of the clear patch's keys.
  // That patch also names `page` and the preset marker — neither of which
  // narrows anything — so reading it would call a bare `?page=3` a filtered
  // search and offer to clear filters that were never applied.
  const hasFilters = activeFilterCount(COMPETITION_FILTER_SPECS, params) > 0;

  return (
    <Empty className="border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          {hasFilters ? <SearchXIcon /> : <MapPinOffIcon />}
        </EmptyMedia>

        <EmptyTitle>
          {hasFilters
            ? "No competitions match these filters"
            : "No competitions yet"}
        </EmptyTitle>

        <EmptyDescription>
          {hasFilters
            ? "Try removing a filter, widening the dates, or including online competitions."
            : "Nothing has been published here yet. Check back soon, or suggest a competition you know about."}
        </EmptyDescription>
      </EmptyHeader>

      <EmptyContent>
        {hasFilters ? (
          <Button asChild variant="outline">
            <Link href={buildSearchHref(PATHNAME, params, clearPatch)}>
              Clear all filters
            </Link>
          </Button>
        ) : (
          <Button asChild variant="outline">
            <Link href="/competitions/suggestions/new">
              Suggest a competition
            </Link>
          </Button>
        )}
      </EmptyContent>
    </Empty>
  );
}
