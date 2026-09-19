"use client";

/**
 * Search Core (React) - Staged filter edits
 *
 * =============================================================================
 * Apply versus instant
 * =============================================================================
 *
 * Both belong in this system, chosen by *surface* rather than by filter.
 *
 * Instant suits the quick bar: one click expresses one complete intent, the
 * result arrives immediately, and the URL is always truthful about what is on
 * screen.
 *
 * Staging suits the advanced panel and the mobile drawer. Those are multi-edit
 * surfaces — a person sets a date range, a team size and three eligibilities
 * before they mean anything by it. Applying each keystroke would fire a
 * navigation per edit, make the result list thrash under them, and leave no
 * way to change their mind, because there would be nothing to cancel.
 *
 * =============================================================================
 * What this does not become
 * =============================================================================
 *
 * The staged buffer is never the source of truth. It holds edits that have not
 * been applied yet, and it is discarded on cancel or superseded on commit. The
 * applied search stays in the URL throughout, which is what keeps the server
 * render and the address bar in agreement no matter what is half-typed in a
 * panel.
 */

import { useCallback, useMemo, useState } from "react";

import { applyParamPatch, type ParamPatch } from "../params";
import type { RawSearchParams } from "../types";

export interface StagedParamsState {
  /**
   * The applied parameters with staged edits laid over them.
   *
   * Controls bind to this, so a staged panel previews its own pending state
   * while the results behind it still reflect what is actually applied.
   */
  readonly params: RawSearchParams;

  /** Records an edit without navigating. */
  readonly stage: (patch: ParamPatch) => void;

  /** Discards every staged edit. */
  readonly reset: () => void;

  /**
   * The single patch representing everything staged.
   *
   * Handed to `apply` on commit, so a panel's worth of edits becomes one
   * navigation and one history entry rather than a dozen.
   */
  readonly pendingPatch: ParamPatch;

  readonly hasPendingChanges: boolean;
}

/**
 * Buffers filter edits until they are committed.
 *
 * @param applied the currently applied parameters, from `useSearchParamsState`
 * @param isOpen  whether the staging surface is open; re-opening starts clean
 */
export function useStagedParams(
  applied: RawSearchParams,
  isOpen: boolean,
): StagedParamsState {
  const [staged, setStaged] = useState<ParamPatch>({});

  // Reopening a panel starts from what is applied, never from edits abandoned
  // last time. A person who closed a drawer without applying has said no to
  // those edits; resurrecting them later would apply a decision they declined.
  //
  // Done by comparing against the previous value during render rather than in
  // an effect. React's documented pattern for "reset state when a prop
  // changes": it re-renders this component immediately with the corrected
  // state, before anything is committed to the screen, instead of painting the
  // stale buffer and then a second time to clear it.
  const [previousIsOpen, setPreviousIsOpen] = useState(isOpen);

  if (previousIsOpen !== isOpen) {
    setPreviousIsOpen(isOpen);

    if (!isOpen) {
      setStaged({});
    }
  }

  const stage = useCallback((patch: ParamPatch) => {
    setStaged((current) => ({ ...current, ...patch }));
  }, []);

  const reset = useCallback(() => setStaged({}), []);

  const params = useMemo(
    // Page is not reset here: staging changes nothing yet, and the reset
    // belongs to the commit, where `apply` performs it.
    () => applyParamPatch(applied, staged),
    [applied, staged],
  );

  const hasPendingChanges = useMemo(() => {
    const appliedSnapshot = applyParamPatch(applied);

    return Object.entries(staged).some(([key, value]) => {
      const current = appliedSnapshot[key];

      // `undefined` and an absent key both mean "not set", so a staged clear
      // of something already unset is correctly not a change.
      return (value ?? undefined) !== (current ?? undefined);
    });
  }, [applied, staged]);

  return { params, stage, reset, pendingPatch: staged, hasPendingChanges };
}
