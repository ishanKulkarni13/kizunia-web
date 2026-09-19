"use client";

import { BookmarkIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { useCompetitionUserState } from "./use-competition-user-state";

/**
 * Bookmark toggle for a competition. Mirrors `CompetitionShareButton`'s
 * shape and guards exactly — the card it sits in is a stretched link
 * (`::after` covers the whole card), so `preventDefault`/`stopPropagation`
 * is required in addition to `relative z-10`; stacking alone does not stop
 * the overlay's click from navigating.
 *
 * Visible when signed out — hiding it would hide the feature from exactly
 * the people who most need to discover it. A click while signed out shows
 * a sign-in prompt instead of sending a request.
 */
export function CompetitionBookmarkButton({
  competitionId,
  title,
}: {
  competitionId: string;
  title: string;
}) {
  const { entry, toggle } = useCompetitionUserState(
    "bookmarked",
    competitionId,
    { on: "Saved for later", off: "Removed from saved" },
  );

  // The button is always clickable — it never waits for the batch read.
  // `entry.value` is the optimistic truth the moment the user clicks, so
  // the icon fills instantly and only reverts if the server rejects it.
  const bookmarked = entry.value;
  const known = entry.status !== "unresolved";

  async function handleClick(event: React.MouseEvent) {
    event.preventDefault();
    event.stopPropagation();

    await toggle();
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="relative z-10 size-8"
      aria-busy={entry.pending}
      aria-pressed={known ? bookmarked : undefined}
      onClick={handleClick}
    >
      <BookmarkIcon
        className={cn(
          "size-4 transition-colors",
          bookmarked ? "fill-current text-primary" : "text-muted-foreground",
        )}
      />

      <span className="sr-only">
        {bookmarked ? `Remove ${title} from saved` : `Save ${title} for later`}
      </span>
    </Button>
  );
}
