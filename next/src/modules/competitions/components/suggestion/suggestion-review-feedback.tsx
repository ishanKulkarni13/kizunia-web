import { AlertTriangleIcon, MessageSquareIcon } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

import type { CompetitionSuggestionStatus } from "../../types/suggestion";

function formatDate(value: Date | string | null) {
  if (!value) return "—";

  return new Date(value).toLocaleDateString();
}

interface SuggestionReviewFeedbackProps {
  status: CompetitionSuggestionStatus;
  reviewNotes: string | null;
  rejectionReason: string | null;
  reviewedAt: string | Date | null;
}

/** Surfaces the admin's latest review feedback on the contributor's own
 * detail page. Only rendered for REJECTED/CHANGES_REQUESTED — everything
 * else has nothing to show here. */
export function SuggestionReviewFeedback({
  status,
  reviewNotes,
  rejectionReason,
  reviewedAt,
}: SuggestionReviewFeedbackProps) {
  if (status !== "REJECTED" && status !== "CHANGES_REQUESTED") {
    return null;
  }

  const reason = status === "REJECTED" ? rejectionReason : reviewNotes;

  return (
    <Alert variant={status === "REJECTED" ? "destructive" : "info"}>
      {status === "REJECTED" ? <AlertTriangleIcon /> : <MessageSquareIcon />}

      <AlertTitle>
        {status === "REJECTED"
          ? "This suggestion was rejected"
          : "Changes were requested"}
      </AlertTitle>

      <AlertDescription className="gap-1">
        {reason ? (
          <p className="whitespace-pre-wrap">{reason}</p>
        ) : (
          <p>No reason was given.</p>
        )}

        {reviewedAt && (
          <p className="text-xs opacity-80">
            Reviewed {formatDate(reviewedAt)}
          </p>
        )}
      </AlertDescription>
    </Alert>
  );
}
