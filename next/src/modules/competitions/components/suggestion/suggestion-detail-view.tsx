"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

import { useCompetitionSuggestionStore } from "../../store/competition-suggestion-store";
import type { CompetitionSuggestionDTO } from "../../types/suggestion";
import { SuggestionFieldsEditor } from "./suggestion-fields-editor";
import { SuggestionAssetGrid } from "./suggestion-asset-grid";
import { SuggestionStatusBadge } from "./suggestion-status-badge";
import { SuggestionReviewFeedback } from "./suggestion-review-feedback";

function formatDate(value: Date | string | null) {
  if (!value) return "—";

  return new Date(value).toLocaleDateString();
}

interface SuggestionDetailViewProps {
  suggestion: CompetitionSuggestionDTO;
}

export function SuggestionDetailView({
  suggestion: initialSuggestion,
}: SuggestionDetailViewProps) {
  const router = useRouter();

  const submit = useCompetitionSuggestionStore(
    (state) => state.submit,
  );

  const reopen = useCompetitionSuggestionStore(
    (state) => state.reopen,
  );

  const [suggestion, setSuggestion] = useState(initialSuggestion);
  const [submitting, setSubmitting] = useState(false);
  const [reopening, setReopening] = useState(false);

  const isDraft = suggestion.status === "DRAFT";

  async function handleSubmitConfirmed() {
    setSubmitting(true);

    try {
      await submit(suggestion.id);

      router.push("/competitions/suggestions");
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  async function handleReopen() {
    setReopening(true);

    try {
      const updated = await reopen(suggestion.id);

      setSuggestion(updated);
    } finally {
      setReopening(false);
    }
  }

  return (
    <div className=" max-w-3xl space-y-6">
      <SuggestionReviewFeedback
        status={suggestion.status}
        reviewNotes={suggestion.reviewNotes}
        rejectionReason={suggestion.rejectionReason}
        reviewedAt={suggestion.reviewedAt}
      />

      {/* Title / Description */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div className="w-full space-y-2">
              {isDraft ? (
                <SuggestionFieldsEditor
                  suggestion={suggestion}
                />
              ) : (
                <>
                  <CardTitle className="text-3xl">
                    {suggestion.suggestionTitle}
                  </CardTitle>

                  <CardDescription>
                    Submitted{" "}
                    {formatDate(suggestion.submittedAt)}
                  </CardDescription>
                </>
              )}
            </div>

            <SuggestionStatusBadge status={suggestion.status} className="shrink-0" />
          </div>
        </CardHeader>

        {!isDraft && (
          <CardContent>
            {suggestion.suggestionContent?.content ? (
              <div className="whitespace-pre-wrap text-sm leading-7">
                {suggestion.suggestionContent.content}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No description was provided.
              </p>
            )}
          </CardContent>
        )}
      </Card>

      {/* Supporting material */}
      <Card>
        <CardHeader>
          <CardTitle>Supporting Material</CardTitle>

          <CardDescription>
            Help us verify this competition. Add
            screenshots, posters, or the official
            competition PDF if you have them.
          </CardDescription>
        </CardHeader>

        <CardContent>
          <SuggestionAssetGrid
            suggestionId={suggestion.id}
            assets={suggestion.assets}
            onAssetsChange={(update) =>
              setSuggestion((prev) => ({
                ...prev,
                assets: update(prev.assets),
              }))
            }
            readOnly={!isDraft}
          />
        </CardContent>
      </Card>

      {/* Associated competition */}
      {suggestion.competitionId && (
        <Card>
          <CardHeader>
            <CardTitle>
              Suggested Competition Update
            </CardTitle>

            <CardDescription>
              This suggestion is associated with an
              existing competition.
            </CardDescription>
          </CardHeader>

          <CardContent>
            <Button asChild variant="outline">
              <Link
                href={`/competitions/${suggestion.competitionId}`}
              >
                View Competition
              </Link>
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-col gap-3">
        {isDraft ? (
          <>
            <Button asChild variant="ghost">
              <Link href="/competitions/suggestions">
                ← Back to My Drafts
              </Link>
            </Button>

            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button disabled={submitting}>
                  {submitting
                    ? "Submitting..."
                    : "Submit Suggestion"}
                </Button>
              </AlertDialogTrigger>

              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    Submit this suggestion?
                  </AlertDialogTitle>

                  <AlertDialogDescription>
                    Once submitted, this suggestion will be
                    sent for review and you won&apos;t be
                    able to edit it.
                  </AlertDialogDescription>
                </AlertDialogHeader>

                <AlertDialogFooter>
                  <AlertDialogCancel>
                    Cancel
                  </AlertDialogCancel>

                  <AlertDialogAction
                    onClick={handleSubmitConfirmed}
                  >
                    Submit Suggestion
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </>
        ) : suggestion.status === "CHANGES_REQUESTED" ? (
          <>
            <Button asChild variant="ghost">
              <Link href="/competitions/suggestions">
                ← Back to My Suggestions
              </Link>
            </Button>

            {/* Reopening only moves the suggestion back to DRAFT — it does
                not discard anything, so unlike Submit this needs no
                confirmation dialog. */}
            <Button onClick={handleReopen} disabled={reopening}>
              {reopening ? "Reopening..." : "Edit Suggestion"}
            </Button>
          </>
        ) : (
          <Button asChild variant="ghost">
            <Link href="/competitions/suggestions">
              ← Back to My Suggestions
            </Link>
          </Button>
        )}
      </div>
    </div>
  );
}
