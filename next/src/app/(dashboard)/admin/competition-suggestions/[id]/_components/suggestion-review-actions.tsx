"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ApiError } from "@/lib/http";

import { useCompetitionSuggestionAdminStore } from "@/modules/competitions/store/competition-suggestion-admin-store";

import { ReviewReasonDialog } from "./review-reason-dialog";

interface SuggestionReviewActionsProps {
  suggestionId: string;
  canApprove: boolean;
  canReject: boolean;
  canRequestChanges: boolean;
  reviewBlockedReason: string | null;
}

function ActionButton({
  children,
  disabled,
  variant,
  blockedReason,
  onClick,
}: {
  children: React.ReactNode;
  disabled: boolean;
  variant?: "default" | "destructive" | "outline";
  blockedReason: string | null;
  onClick: () => void;
}) {
  const button = (
    <Button variant={variant} disabled={disabled} onClick={onClick}>
      {children}
    </Button>
  );

  if (!disabled || !blockedReason) {
    return button;
  }

  // A disabled button doesn't fire pointer events, so the tooltip trigger
  // has to be a wrapping element, not the button itself.
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0}>{button}</span>
      </TooltipTrigger>
      <TooltipContent>{blockedReason}</TooltipContent>
    </Tooltip>
  );
}

/**
 * The three moderation buttons are always rendered, even for a DRAFT or
 * already-decided suggestion — disabled-but-visible, not hidden, so an
 * admin can still tell there's a forgotten draft. The backend is what
 * actually enforces the precondition; a disabled button here is UX only.
 */
export function SuggestionReviewActions({
  suggestionId,
  canApprove,
  canReject,
  canRequestChanges,
  reviewBlockedReason,
}: SuggestionReviewActionsProps) {
  const router = useRouter();

  const approve = useCompetitionSuggestionAdminStore((state) => state.approve);
  const reject = useCompetitionSuggestionAdminStore((state) => state.reject);
  const requestChanges = useCompetitionSuggestionAdminStore(
    (state) => state.requestChanges,
  );

  const [confirmingApprove, setConfirmingApprove] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [requestChangesOpen, setRequestChangesOpen] = useState(false);
  const [approving, setApproving] = useState(false);

  async function handleApprove() {
    setApproving(true);

    try {
      await approve(suggestionId);
      toast.success("Suggestion approved.");
      setConfirmingApprove(false);
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : "Could not approve this suggestion.",
      );
    } finally {
      setApproving(false);
    }
  }

  async function handleReject(reason: string | undefined) {
    try {
      await reject(suggestionId, reason);
      toast.success("Suggestion rejected.");
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : "Could not reject this suggestion.",
      );
    }
  }

  async function handleRequestChanges(reason: string | undefined) {
    try {
      await requestChanges(suggestionId, reason);
      toast.success("Changes requested.");
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof ApiError
          ? error.message
          : "Could not request changes on this suggestion.",
      );
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      <ActionButton
        disabled={!canRequestChanges}
        variant="outline"
        blockedReason={reviewBlockedReason}
        onClick={() => setRequestChangesOpen(true)}
      >
        Request Changes
      </ActionButton>

      <ActionButton
        disabled={!canReject}
        variant="destructive"
        blockedReason={reviewBlockedReason}
        onClick={() => setRejectOpen(true)}
      >
        Reject
      </ActionButton>

      <ActionButton
        disabled={!canApprove}
        blockedReason={reviewBlockedReason}
        onClick={() => setConfirmingApprove(true)}
      >
        Approve
      </ActionButton>

      <AlertDialog open={confirmingApprove} onOpenChange={setConfirmingApprove}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Approve this suggestion?</AlertDialogTitle>
            <AlertDialogDescription>
              This records your decision. It does not create a competition —
              you&apos;ll still need to create that separately.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={approving} onClick={handleApprove}>
              {approving ? "Approving..." : "Approve"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ReviewReasonDialog
        open={rejectOpen}
        onOpenChange={setRejectOpen}
        title="Reject this suggestion?"
        description="The contributor will see this reason. Leave it blank if you don't need to explain."
        confirmLabel="Reject"
        confirmVariant="destructive"
        onConfirm={handleReject}
      />

      <ReviewReasonDialog
        open={requestChangesOpen}
        onOpenChange={setRequestChangesOpen}
        title="Request changes"
        description="The contributor will see this and can edit and resubmit their suggestion."
        confirmLabel="Request Changes"
        onConfirm={handleRequestChanges}
      />
    </div>
  );
}
