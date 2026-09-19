/**
 * Search Core (React) - Pagination
 *
 * =============================================================================
 * The defect this component exists to make impossible
 * =============================================================================
 *
 * A pagination link written by hand as `?page=2` discards every other query
 * parameter — every filter, the sort, the location. That is not hypothetical:
 * it is what the competition listing did, and it was harmless only because
 * nothing yet set those parameters.
 *
 * The fix is not to remember to re-append them at each link site. It is for
 * "a link to another page of this search" to be one component that takes the
 * current parameters, so forgetting is not an available mistake.
 *
 * Deliberately has no `"use client"`: it renders from props with no hooks and
 * no interactivity beyond links, so it stays part of the server-rendered
 * document. Pagination that required hydration would be unusable for the
 * moment the page is loading and invisible to crawlers following the listing.
 */

import Link from "next/link";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";

import { cn } from "@/lib/utils";

import { pageHref } from "../params";
import type { PaginationMeta, RawSearchParams } from "../types";

export interface SearchPaginationProps {
  readonly pagination: PaginationMeta;

  /** The current search. Every parameter here survives a page change. */
  readonly params: RawSearchParams;

  readonly pathname: string;

  /**
   * How many numbered links to show around the current page.
   *
   * Bounded because a listing with hundreds of pages would otherwise render a
   * row of links wider than the viewport and useless to navigate.
   */
  readonly siblings?: number;

  readonly className?: string;
}

/**
 * The page numbers to render, with gaps marked.
 *
 * First and last are always present so the ends of the result set stay one
 * click away, however deep the current page is.
 */
function pageItems(
  current: number,
  total: number,
  siblings: number,
): readonly (number | "gap")[] {
  if (total <= 1) {
    return [];
  }

  const items: (number | "gap")[] = [];

  const from = Math.max(2, current - siblings);
  const to = Math.min(total - 1, current + siblings);

  items.push(1);

  if (from > 2) {
    items.push("gap");
  }

  for (let page = from; page <= to; page += 1) {
    items.push(page);
  }

  if (to < total - 1) {
    items.push("gap");
  }

  if (total > 1) {
    items.push(total);
  }

  return items;
}

export function SearchPagination({
  pagination,
  params,
  pathname,
  siblings = 1,
  className,
}: SearchPaginationProps) {
  const { page, totalPages, hasNextPage, hasPreviousPage } = pagination;

  if (totalPages <= 1) {
    return null;
  }

  const items = pageItems(page, totalPages, siblings);

  const linkClass =
    "inline-flex h-9 min-w-9 items-center justify-center rounded-md border px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

  return (
    <nav
      aria-label="Pagination"
      className={cn("flex items-center justify-center gap-1.5", className)}
    >
      {hasPreviousPage ? (
        <Link
          href={pageHref(pathname, params, page - 1)}
          aria-label="Previous page"
          className={cn(linkClass, "border-border hover:bg-muted")}
          scroll={false}
        >
          <ChevronLeftIcon className="size-4" aria-hidden />
          <span className="ml-1 hidden sm:inline">Previous</span>
        </Link>
      ) : (
        <span
          aria-hidden
          className={cn(linkClass, "border-transparent opacity-40")}
        >
          <ChevronLeftIcon className="size-4" />
          <span className="ml-1 hidden sm:inline">Previous</span>
        </span>
      )}

      {items.map((item, index) =>
        item === "gap" ? (
          <span
            key={`gap-${index}`}
            aria-hidden
            className="px-1 text-sm text-muted-foreground"
          >
            …
          </span>
        ) : (
          <Link
            key={item}
            href={pageHref(pathname, params, item)}
            aria-label={`Page ${item}`}
            aria-current={item === page ? "page" : undefined}
            scroll={false}
            className={cn(
              linkClass,
              "tabular-nums",
              item === page
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border hover:bg-muted",
            )}
          >
            {item}
          </Link>
        ),
      )}

      {hasNextPage ? (
        <Link
          href={pageHref(pathname, params, page + 1)}
          aria-label="Next page"
          className={cn(linkClass, "border-border hover:bg-muted")}
          scroll={false}
        >
          <span className="mr-1 hidden sm:inline">Next</span>
          <ChevronRightIcon className="size-4" aria-hidden />
        </Link>
      ) : (
        <span
          aria-hidden
          className={cn(linkClass, "border-transparent opacity-40")}
        >
          <span className="mr-1 hidden sm:inline">Next</span>
          <ChevronRightIcon className="size-4" />
        </span>
      )}
    </nav>
  );
}
