"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useReducer,
  useRef,
  useState,
} from "react";

import { authClient } from "@/lib/auth-client";
import { ApiError } from "@/lib/http";

import { CompetitionUserStateApi } from "../../api/competition-user-state-api";
import {
  UNRESOLVED_ENTRY,
  userStateReducer,
  type UserStateEntry,
} from "./user-state-reducer";

type Kind = "bookmarked" | "registered";

interface CompetitionUserStateContextValue {
  getEntry(kind: Kind, competitionId: string): UserStateEntry;
  register(competitionId: string): void;
  toggle(kind: Kind, competitionId: string): Promise<void>;
}

const CompetitionUserStateContext =
  createContext<CompetitionUserStateContextValue | null>(null);

/**
 * Batches one "my state for these competitions" request per page, rather
 * than one per card — see the module README for why this exists instead
 * of a field on the public competition DTOs (the list page must stay a
 * cacheable, indexable Server Component, and the detail page's fetch does
 * not forward cookies).
 *
 * Page-scoped, not a Zustand store: this state is derived from whatever
 * happens to be on screen and must reset on navigation, which is exactly
 * `useState`/context's lifetime, not a long-lived feature store's.
 */
export function CompetitionUserStateProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = authClient.useSession();
  const isAnonymous = !session.isPending && !session.data;

  const [bookmarked, dispatchBookmarked] = useReducer(userStateReducer, {});
  const [registered, dispatchRegistered] = useReducer(userStateReducer, {});

  const pendingIdsRef = useRef<Set<string>>(new Set());
  const knownIdsRef = useRef<Set<string>>(new Set());
  const [flushToken, setFlushToken] = useState(0);

  const register = useCallback(
    (competitionId: string) => {
      if (knownIdsRef.current.has(competitionId)) return;

      knownIdsRef.current.add(competitionId);

      if (isAnonymous) {
        dispatchBookmarked({ type: "MARK_ANONYMOUS", ids: [competitionId] });
        dispatchRegistered({ type: "MARK_ANONYMOUS", ids: [competitionId] });
        return;
      }

      pendingIdsRef.current.add(competitionId);
      setFlushToken((token) => token + 1);
    },
    [isAnonymous],
  );

  // One batch fetch per microtask-ish tick, covering every id registered
  // since the last flush — not one request per button.
  useEffect(() => {
    if (session.isPending) return;
    if (pendingIdsRef.current.size === 0) return;

    if (isAnonymous) {
      const ids = Array.from(pendingIdsRef.current);
      pendingIdsRef.current.clear();
      dispatchBookmarked({ type: "MARK_ANONYMOUS", ids });
      dispatchRegistered({ type: "MARK_ANONYMOUS", ids });
      return;
    }

    const ids = Array.from(pendingIdsRef.current);
    pendingIdsRef.current.clear();

    let cancelled = false;

    CompetitionUserStateApi.list(ids)
      .then((states) => {
        if (cancelled) return;

        const bookmarkedValues: Record<string, boolean> = {};
        const registeredValues: Record<string, boolean> = {};

        for (const state of states) {
          bookmarkedValues[state.competitionId] = state.bookmarked;
          registeredValues[state.competitionId] = state.registered;
        }

        dispatchBookmarked({ type: "BATCH_RESOLVED", values: bookmarkedValues });
        dispatchRegistered({ type: "BATCH_RESOLVED", values: registeredValues });
      })
      .catch(() => {
        // Leave these ids unresolved rather than surfacing an error toast
        // for a background read — the controls simply stay disabled, and
        // whatever the user was doing on the page is unaffected.
      });

    return () => {
      cancelled = true;
    };
  }, [flushToken, isAnonymous, session.isPending]);

  const getEntry = useCallback(
    (kind: Kind, competitionId: string): UserStateEntry => {
      const map = kind === "bookmarked" ? bookmarked : registered;
      return map[competitionId] ?? UNRESOLVED_ENTRY;
    },
    [bookmarked, registered],
  );

  const toggle = useCallback(
    async (kind: Kind, competitionId: string) => {
      const dispatch = kind === "bookmarked" ? dispatchBookmarked : dispatchRegistered;
      const map = kind === "bookmarked" ? bookmarked : registered;
      const entry = map[competitionId] ?? UNRESOLVED_ENTRY;

      // Only an in-flight request blocks a toggle. An unresolved entry is
      // deliberately actionable: the control responds on the first click
      // rather than making the user wait for the batch read, and the
      // optimistic value survives that read landing (see the reducer's
      // BATCH_RESOLVED case).
      if (entry.pending) return;

      const previousValue = entry.value;
      const nextValue = !previousValue;

      dispatch({ type: "OPTIMISTIC_SET", id: competitionId, value: nextValue });

      try {
        if (kind === "bookmarked") {
          await (nextValue
            ? CompetitionUserStateApi.addBookmark(competitionId)
            : CompetitionUserStateApi.removeBookmark(competitionId));
        } else {
          await (nextValue
            ? CompetitionUserStateApi.markRegistered(competitionId)
            : CompetitionUserStateApi.unmarkRegistered(competitionId));
        }

        dispatch({ type: "COMMIT", id: competitionId });
      } catch (error) {
        dispatch({ type: "ROLLBACK", id: competitionId, previousValue });
        throw error;
      }
    },
    [bookmarked, registered],
  );

  return (
    <CompetitionUserStateContext.Provider
      value={{ getEntry, register, toggle }}
    >
      {children}
    </CompetitionUserStateContext.Provider>
  );
}

export function useCompetitionUserStateContext() {
  const context = useContext(CompetitionUserStateContext);

  if (!context) {
    throw new Error(
      "useCompetitionUserStateContext must be used within a CompetitionUserStateProvider",
    );
  }

  return context;
}

export function messageForError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) {
      return "Sign in to do this.";
    }
    if (error.status === 404) {
      return "This competition is no longer available.";
    }
    if (error.status === 429) {
      return "Too many changes just now. Try again in a moment.";
    }
    return error.message;
  }

  return "Something went wrong. Please try again.";
}
