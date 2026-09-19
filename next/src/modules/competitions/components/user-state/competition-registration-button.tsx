"use client";

import { CheckCircle2Icon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { useCompetitionUserState } from "./use-competition-user-state";

/**
 * Mark-as-registered toggle for the competition detail page header.
 *
 * This is the user's own, unverified record — Kizunia is a discovery
 * platform, not the organizer, and has no channel to confirm a
 * registration. Every string here is written to read as the user's own
 * claim, never as an organizer-confirmed status: no "Registered ✓", no
 * "Confirmed"/"Verified", and the button is visually a bordered control,
 * never styled like `StatusBadge`'s filled status pill. The "we don't
 * verify this" caveat lives in the tooltip so the header stays compact.
 *
 * Renders unconditionally — even when the competition has no
 * `registrationLink` (the user may have registered through a channel
 * Kizunia doesn't know about) and regardless of `CompetitionStatus` (see
 * `CompetitionRegistrationService`'s docblock for why there is no
 * "registration is closed" gate).
 */
export function CompetitionRegistrationButton({
  competitionId,
}: {
  competitionId: string;
}) {
  const { entry, toggle } = useCompetitionUserState(
    "registered",
    competitionId,
    { on: "Marked as registered", off: "Registration mark removed" },
  );

  // Always clickable; `entry.value` is the optimistic truth from the
  // instant the user clicks.
  const registered = entry.value;
  const known = entry.status !== "unresolved";

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-busy={entry.pending}
            aria-pressed={known ? registered : undefined}
            onClick={() => toggle()}
            className={cn(
              "transition-colors",
              registered && "border-primary text-primary",
            )}
          >
            <CheckCircle2Icon
              className={cn("size-4", registered && "fill-current")}
            />
            {registered ? "Registered" : "I registered"}
          </Button>
        </TooltipTrigger>

        <TooltipContent>
          Your own record — Kizunia doesn&apos;t verify registrations with
          organizers.
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
