import Link from "next/link";

import { cn } from "@/lib/utils";
import { buildSearchHref, type RawSearchParams } from "@/lib/search";

import { SUGGESTION_ADMIN_STATUS_FILTERS } from "@/modules/competitions/search/suggestion-admin-query";

const LABELS: Record<(typeof SUGGESTION_ADMIN_STATUS_FILTERS)[number], string> = {
  UNDER_REVIEW: "Under Review",
  DRAFT: "Draft",
  CHANGES_REQUESTED: "Changes Requested",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  WITHDRAWN: "Withdrawn",
  ALL: "All",
};

interface SuggestionStatusFilterProps {
  pathname: string;
  params: RawSearchParams;
}

/**
 * Six status chips, not the heavier `src/lib/search` filter-spec/preset
 * engine — this list has exactly one real filter. Absent `status` means
 * UNDER_REVIEW is active (see `CompetitionSuggestionAdminQuerySchema`'s
 * default), so that chip must render as active when the param is missing.
 */
export function SuggestionStatusFilter({
  pathname,
  params,
}: SuggestionStatusFilterProps) {
  const active = (
    typeof params.status === "string" ? params.status.toUpperCase() : undefined
  ) ?? "UNDER_REVIEW";

  return (
    <div className="flex flex-wrap gap-2" role="tablist" aria-label="Filter by status">
      {SUGGESTION_ADMIN_STATUS_FILTERS.map((status) => {
        const isActive = status === active;

        return (
          <Link
            key={status}
            href={buildSearchHref(
              pathname,
              params,
              { status: status === "UNDER_REVIEW" ? undefined : status },
              { resetPage: true },
            )}
            role="tab"
            aria-selected={isActive}
            className={cn(
              "rounded-full border px-3 py-1 text-sm font-medium transition-colors",
              isActive
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border text-muted-foreground hover:bg-muted",
            )}
          >
            {LABELS[status]}
          </Link>
        );
      })}
    </div>
  );
}
