import Link from "next/link";
import { SearchXIcon, TriangleAlertIcon } from "lucide-react";

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
import { SessionService } from "@/lib/auth/session";
import { PlatformRole } from "@/authorization";

import { projectService } from "@/modules/projects/backend/service";
import { ProjectCards } from "@/modules/projects/frontend/components/discovery/project-cards";
import { ProjectFilters } from "@/modules/projects/frontend/components/discovery/project-filters";
import { PROJECT_FILTER_SPECS } from "@/modules/projects/search/ui";
import { TaxonomyService } from "@/modules/taxonomy";
import { Metadata } from "next/types";

const PATHNAME = "/projects";

export const metadata: Metadata = {
  title: "Projects",
  description:
    "Discover interesting projects built by the Kizunia community and explore ideas, technologies, and creators.",
  alternates: {
    canonical: "/projects",
  },
};

interface Props {
  searchParams: Promise<RawSearchParams>;
}


/**
 * Project discovery — the public listing.
 *
 * Stays a Server Component on the same pattern as `/competitions`
 * (`src/app/(dashboard)/(competition)/competitions/page.tsx`): the search
 * runs here, against the URL, so results are shareable, indexable and
 * correct on first paint. Only the filter controls are client components,
 * and they do nothing but write back to the URL this page reads.
 *
 * `visibility`/`status` are never read, checked, or filtered on here — the
 * public scope guard in `projects/search/definition.ts` is the only place
 * that decides which rows exist for this page, and it is applied inside
 * `projectService.search` before a row ever reaches this component.
 */
export default async function ProjectsPage({ searchParams }: Props) {
  const params = await searchParams;

  const actor = await SessionService.getOptionalActor();

  const actorData = {
    id: actor?.id ?? null,
    role: actor?.role ?? PlatformRole.USER,
    banned: actor?.banned ?? false,
  };

  // Options load independently of the search and must not be able to fail
  // it: a taxonomy outage should cost the pickers their labels, not take
  // down browsing. Settled rather than awaited together for exactly that
  // reason — mirrors the Competitions page.
  const [searchOutcome, categories, technologies] = await Promise.allSettled([
    projectService.search(params, actorData),
    TaxonomyService.listCategories({
      limit: 200,
      includeEmpty: false,
      entity: "project",
    }),
    TaxonomyService.listTechnologies({
      limit: 200,
      includeEmpty: false,
      entity: "project",
    }),
  ]);

  const optionsMap = {
    categories: categories.status === "fulfilled" ? categories.value : [],
    technologies: technologies.status === "fulfilled" ? technologies.value : [],
  };

  if (searchOutcome.status === "rejected") {
    return (
      <ProjectsShell optionsMap={optionsMap}>
        <SearchFailure error={searchOutcome.reason} params={params} />
      </ProjectsShell>
    );
  }

  const { items, pagination } = searchOutcome.value;

  return (
    <ProjectsShell optionsMap={optionsMap} total={pagination.total}>
      {items.length === 0 ? (
        <EmptyResults params={params} />
      ) : (
        <ProjectCards projects={items} />
      )}

      <SearchPagination
        pagination={pagination}
        params={params}
        pathname={PATHNAME}
        className="mx-auto w-full max-w-4xl pt-2"
      />
    </ProjectsShell>
  );
}

/**
 * Page chrome shared by every outcome.
 *
 * The filter bar renders even when the search failed, for the same reason
 * as on `/competitions`: losing the controls along with the results would
 * leave someone stranded with no way to change the query that broke it.
 */
function ProjectsShell({
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
    <PageWrapper breadcrumbs={[{ label: "Projects", href: PATHNAME }]}>
      <div className="space-y-2">
        <h1 className="text-4xl font-bold tracking-tight">Projects</h1>

        <p className="max-w-2xl text-muted-foreground">
          Discover what people are building — browse public projects by
          category and technology.
        </p>
      </div>

      <ProjectFilters optionsMap={optionsMap} />

      {total !== undefined && (
        <p
          className="text-sm text-muted-foreground"
          role="status"
          aria-live="polite"
        >
          {total === 1 ? "1 project" : `${total} projects`}
        </p>
      )}

      {children}
    </PageWrapper>
  );
}

/**
 * A search that could not be completed.
 *
 * Distinguished from an empty result deliberately — the two mean opposite
 * things, and only a recognised application error's message is shown. See
 * the equivalent function on `/competitions` for the fuller rationale.
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
    : "Something went wrong while loading projects.";

  if (!isKnown) {
    console.error("Project search failed.", error);
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
            <Link href={buildSearchHref(PATHNAME, params)}>Try again</Link>
          </Button>

          <Button asChild size="sm" variant="ghost">
            <Link
              href={buildSearchHref(
                PATHNAME,
                params,
                clearAllFiltersPatch(PROJECT_FILTER_SPECS),
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
 * The copy distinguishes an over-narrow search from an empty platform —
 * the two need different things from the reader.
 */
function EmptyResults({ params }: { params: RawSearchParams }) {
  const clearPatch = clearAllFiltersPatch(PROJECT_FILTER_SPECS);

  const hasFilters = activeFilterCount(PROJECT_FILTER_SPECS, params) > 0;

  return (
    <Empty className="border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <SearchXIcon />
        </EmptyMedia>

        <EmptyTitle>
          {hasFilters ? "No projects match these filters" : "No projects yet"}
        </EmptyTitle>

        <EmptyDescription>
          {hasFilters
            ? "Try removing a filter or broadening your search."
            : "Nothing has been published here yet. Check back soon."}
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
