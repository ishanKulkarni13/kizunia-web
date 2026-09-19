"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { CardContent } from "@/components/ui/card";
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

export function AddCompetitionSuggestion() {
  const router = useRouter();

  const create = useCompetitionSuggestionStore(
    (state) => state.create,
  );

  const submit = useCompetitionSuggestionStore(
    (state) => state.submit,
  );

  const loading = useCompetitionSuggestionStore(
    (state) => state.loading,
  );

  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [draft, setDraft] = useState<CompetitionSuggestionDTO | null>(
    null,
  );
  const [submitting, setSubmitting] = useState(false);

  async function handleCreateDraft() {
    const suggestion = await create({
      suggestionTitle: title,
      ...(content.trim()
        ? { suggestionContent: content }
        : {}),
    });

    setDraft(suggestion);
  }

  async function submitSuggestion(id: string) {
    setSubmitting(true);

    try {
      await submit(id);

      router.push("/competitions/suggestions");
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSubmitConfirmed() {
    if (draft) {
      await submitSuggestion(draft.id);
      return;
    }

    // No draft was ever created — Submit Suggestion is independently
    // clickable from the initial state, so this creates and submits in one
    // step. There is no draft stage in this path, so no assets are expected
    // to be attached before navigating away.
    const suggestion = await create({
      suggestionTitle: title,
      ...(content.trim()
        ? { suggestionContent: content }
        : {}),
    });

    await submitSuggestion(suggestion.id);
  }

  const canSubmit = draft
    ? true
    : title.trim().length >= 3;

  return (
    <div className=" w-full max-w-3xl">
      <CardContent className="space-y-8">
        {draft ? (
          <SuggestionFieldsEditor suggestion={draft} />
        ) : (
          <div className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="suggestion-title">
                Competition title
              </Label>

              <Input
                id="suggestion-title"
                value={title}
                onChange={(event) =>
                  setTitle(event.target.value)
                }
                placeholder="e.g. Google Solution Challenge"
                minLength={3}
                maxLength={150}
                required
                disabled={loading}
              />

              <p className="text-sm text-muted-foreground">
                Required
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="suggestion-content">
                Description
              </Label>

              <Textarea
                id="suggestion-content"
                value={content}
                onChange={(event) =>
                  setContent(event.target.value)
                }
                placeholder="Tell us anything useful about the competition..."
                rows={10}
                disabled={loading}
                className="resize-y"
              />

              <p className="text-sm text-muted-foreground">
                Optional. You can include dates, organizer
                details, links, prizes, or anything else you
                know. Markdown/MDX content is supported.
              </p>
            </div>
          </div>
        )}

        <div className="space-y-2">
          <Label>Supporting material</Label>

          <p className="text-sm text-muted-foreground">
            Help us verify this competition. Add
            screenshots, posters, or the official
            competition PDF if you have them.
          </p>

          {draft ? (
            <SuggestionAssetGrid
              suggestionId={draft.id}
              assets={draft.assets}
              onAssetsChange={(update) =>
                setDraft((prev) =>
                  prev ? { ...prev, assets: update(prev.assets) } : prev,
                )
              }
            />
          ) : (
            <p className="text-sm text-muted-foreground italic">
              Create a draft first to attach supporting
              material.
            </p>
          )}
        </div>

        <div className="flex flex-col gap-3">
          {!draft && (
            <Button
              type="button"
              variant="outline"
              onClick={handleCreateDraft}
              disabled={loading || title.trim().length < 3}
            >
              {loading ? "Creating..." : "Create Draft"}
            </Button>
          )}

          {draft && (
            <Button asChild variant="ghost">
              <Link href="/competitions/suggestions">
                Back to My Drafts
              </Link>
            </Button>
          )}

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                type="button"
                disabled={loading || submitting || !canSubmit}
              >
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
        </div>
      </CardContent>
    </div>
  );
}
