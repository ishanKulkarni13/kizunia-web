"use client";

import { useEffect } from "react";
import { toast } from "sonner";

import {
  messageForError,
  useCompetitionUserStateContext,
} from "./competition-user-state-provider";
import type { UserStateEntry } from "./user-state-reducer";

interface UseCompetitionUserStateResult {
  entry: UserStateEntry;
  toggle: () => Promise<void>;
}

/**
 * One competition's bookmark or registration state, backed by the shared
 * `CompetitionUserStateProvider`. Registers the id on mount so the
 * provider can include it in its next batch read.
 */
export function useCompetitionUserState(
  kind: "bookmarked" | "registered",
  competitionId: string,
  successMessages: { on: string; off: string },
): UseCompetitionUserStateResult {
  const { getEntry, register, toggle } = useCompetitionUserStateContext();

  useEffect(() => {
    register(competitionId);
  }, [register, competitionId]);

  const entry = getEntry(kind, competitionId);

  async function handleToggle() {
    if (entry.status === "anonymous") {
      toast.error("Sign in required", {
        description:
          kind === "bookmarked"
            ? "Sign in to save competitions."
            : "Sign in to mark competitions as registered.",
        action: {
          label: "Sign in",
          onClick: () => {
            window.location.href = `/sign-in?redirect=${encodeURIComponent(
              window.location.pathname,
            )}`;
          },
        },
      });
      return;
    }

    if (entry.pending) return;

    const wasOn = entry.value;

    try {
      await toggle(kind, competitionId);
      toast[wasOn ? "info" : "success"](wasOn ? successMessages.off : successMessages.on);
    } catch (error) {
      toast.error(messageForError(error));
    }
  }

  return { entry, toggle: handleToggle };
}
