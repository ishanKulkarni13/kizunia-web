"use client";

/**
 * Search Core (React) - URL state
 *
 * =============================================================================
 * The single navigation seam
 * =============================================================================
 *
 * Every change to the applied search goes through `apply`. Nothing else in the
 * application constructs a search URL or calls the router with one.
 *
 * That matters more than it might appear. The applied search is the canonical
 * state; the moment two places know how to write it, they can disagree about
 * page resetting, about history behaviour, or about whether an unrelated query
 * parameter survives. Concentrating it here makes those decisions apply
 * everywhere by construction.
 *
 * =============================================================================
 * Why the URL and not a store
 * =============================================================================
 *
 * The listing is server-rendered from `searchParams`, so the URL is not a
 * mirror of the state — it *is* the state. Keeping a client store as the
 * source of truth would mean the server rendered one search while the client
 * believed in another, and would give up shareable links, working back and
 * forward buttons, and refresh persistence to get nothing back.
 *
 * Client state is still the right tool for genuinely transient things: whether
 * a drawer is open, and edits staged behind an Apply button. Those never
 * become the applied search until committed — see `useStagedParams`.
 */

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useTransition } from "react";

import {
  applyParamPatch,
  toQueryString,
  type ParamPatch,
} from "../params";
import type { RawSearchParams } from "../types";

/**
 * How a change should affect browser history.
 *
 * "push" makes the change undoable with the back button, which is what a
 * person expects after toggling a filter.
 *
 * "replace" is for changes that arrive continuously — a text field emitting on
 * every debounce tick. Pushing those would bury the previous page under a
 * dozen history entries, and pressing back would step through the search
 * letter by letter instead of leaving it.
 */
export type HistoryMode = "push" | "replace";

export interface ApplySearchOptions {
  readonly history?: HistoryMode;

  /**
   * Return to the first page.
   *
   * Defaults to `true`, because almost every change alters which rows match
   * and page 7 of the previous result set is then meaningless. Pagination
   * itself passes `false`, being the one navigation that happens *within* an
   * unchanged result set.
   */
  readonly resetPage?: boolean;
}

export interface SearchParamsState {
  /** The applied search, as the server sees it. */
  readonly params: RawSearchParams;

  /** Applies a patch and navigates. The only way the search changes. */
  readonly apply: (patch: ParamPatch, options?: ApplySearchOptions) => void;

  /**
   * True while the server is rendering the new results.
   *
   * Surfaced so the interface can dim the current results instead of blanking
   * them. Replacing results with a spinner loses the user's place; keeping
   * them visible and slightly muted communicates "working" without discarding
   * the context they were reading.
   */
  readonly isPending: boolean;
}

/**
 * Converts Next's `ReadonlyURLSearchParams` into the plain bag the rest of the
 * search core works with.
 *
 * A repeated key becomes an array, matching exactly what a Server Component
 * receives in `searchParams` — so client and server decode identical input and
 * cannot reach different conclusions about the same URL.
 */
function toRawParams(source: URLSearchParams): RawSearchParams {
  const params: RawSearchParams = {};

  for (const key of new Set(source.keys())) {
    const values = source.getAll(key);

    params[key] = values.length > 1 ? values : values[0];
  }

  return params;
}

export function useSearchParamsState(): SearchParamsState {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [isPending, startTransition] = useTransition();

  // `searchParams` is a new object identity on every render, so the string is
  // the honest dependency — it changes exactly when the search does.
  const serialized = searchParams.toString();

  const params = useMemo(
    () => toRawParams(new URLSearchParams(serialized)),
    [serialized],
  );

  const apply = useCallback(
    (patch: ParamPatch, options: ApplySearchOptions = {}) => {
      const next = applyParamPatch(params, patch, {
        resetPage: options.resetPage ?? true,
      });

      const query = toQueryString(next);

      const href = query.length > 0 ? `${pathname}?${query}` : pathname;

      const navigate =
        (options.history ?? "push") === "push" ? router.push : router.replace;

      // Inside a transition so React keeps the current results on screen while
      // the server renders the next ones, rather than unmounting them and
      // showing a loading state the user has to re-orient after.
      //
      // `scroll: false` because a filter change should leave the viewport
      // where it is. Jumping to the top after every toggle would make the
      // filter bar itself scroll away from under the cursor.
      startTransition(() => {
        navigate(href, { scroll: false });
      });
    },
    [params, pathname, router],
  );

  return { params, apply, isPending };
}
