import Link from "next/link";

import { PlatformAction } from "@/authorization/platform/actions";
import { PlatformAuthorizer } from "@/authorization/platform/authorizer";
import type { StrictAuthorizationActor } from "@/authorization";
import PageWrapper from "@/components/page-wrapper";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { SessionService } from "@/lib/auth/session";
import { AuthenticationError } from "@/lib/errors";

import { CompetitionSuggestionService } from "@/modules/competitions/backend/suggestion/service";
import { SuggestionStatusBadge } from "@/modules/competitions/components/suggestion/suggestion-status-badge";

import { AdminSuggestionAssetGrid } from "./_components/admin-suggestion-asset-grid";
import { SuggestionReviewActions } from "./_components/suggestion-review-actions";

function formatDate(value: Date | string | null): string {
  if (!value) return "—";

  return new Date(value).toLocaleString();
}

interface Props {
  params: Promise<{ id: string }>;
}

export default async function AdminCompetitionSuggestionDetailPage({
  params,
}: Props) {
  const { id } = await params;

  const actor = await SessionService.getActor();

  if (!actor || !actor.role || !!actor.banned || !actor.id) {
    throw new AuthenticationError({
      code: "UNAUTHORIZED",
      message: "You are not authorized to access this page.",
      status: 401,
    });
  }

  const strictActor: StrictAuthorizationActor = {
    id: actor.id,
    role: actor.role,
    banned: actor.banned ?? true,
  };

  PlatformAuthorizer.can(
    { actor: strictActor },
    PlatformAction.VIEW_COMPETITION_SUGGESTIONS,
  );

  const suggestion = await CompetitionSuggestionService.findByIdForReview({
    actor: strictActor,
    id,
  });

  const hasFeedback = suggestion.reviewNotes || suggestion.rejectionReason;

  return (
    <PageWrapper
      breadcrumbs={[
        { label: "Competition Suggestions", href: "/admin/competition-suggestions" },
        { label: suggestion.suggestionTitle, href: `/admin/competition-suggestions/${id}` },
      ]}
    >
      <div className="max-w-3xl space-y-6">
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-4">
              <div>
                <CardTitle className="text-3xl">
                  {suggestion.suggestionTitle}
                </CardTitle>
                <CardDescription>
                  Submitted by {suggestion.submitter.name} (
                  {suggestion.submitter.email})
                </CardDescription>
              </div>

              <SuggestionStatusBadge status={suggestion.status} className="shrink-0" />
            </div>

            <dl className="grid grid-cols-2 gap-x-6 gap-y-1 pt-2 text-sm text-muted-foreground sm:grid-cols-3">
              <div>
                <dt className="text-xs uppercase tracking-wide">Submitted</dt>
                <dd>{formatDate(suggestion.submittedAt)}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide">Created</dt>
                <dd>{formatDate(suggestion.createdAt)}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide">Reviewed</dt>
                <dd>
                  {formatDate(suggestion.reviewedAt)}
                  {suggestion.reviewedBy ? ` by ${suggestion.reviewedBy.name}` : ""}
                </dd>
              </div>
            </dl>
          </CardHeader>

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
        </Card>

        {hasFeedback && (
          <Card>
            <CardHeader>
              <CardTitle>Current Feedback</CardTitle>
              <CardDescription>
                The latest moderation note recorded for this suggestion.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {suggestion.rejectionReason && (
                <p>
                  <span className="font-medium">Rejection reason: </span>
                  {suggestion.rejectionReason}
                </p>
              )}
              {suggestion.reviewNotes && (
                <p>
                  <span className="font-medium">Requested changes: </span>
                  {suggestion.reviewNotes}
                </p>
              )}
            </CardContent>
          </Card>
        )}

        {suggestion.competitionId && (
          <Card>
            <CardHeader>
              <CardTitle>Suggested Competition Update</CardTitle>
              <CardDescription>
                This suggestion is associated with an existing competition.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild variant="outline">
                <Link href={`/competitions/${suggestion.competitionId}`}>
                  View Competition
                </Link>
              </Button>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Supporting Material</CardTitle>
            <CardDescription>
              Admins may remove a file at any time, regardless of status.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AdminSuggestionAssetGrid
              suggestionId={suggestion.id}
              assets={suggestion.assets}
              canRemoveAssets={suggestion.canRemoveAssets}
            />
          </CardContent>
        </Card>

        <SuggestionReviewActions
          suggestionId={suggestion.id}
          canApprove={suggestion.canApprove}
          canReject={suggestion.canReject}
          canRequestChanges={suggestion.canRequestChanges}
          reviewBlockedReason={suggestion.reviewBlockedReason}
        />
      </div>
    </PageWrapper>
  );
}
