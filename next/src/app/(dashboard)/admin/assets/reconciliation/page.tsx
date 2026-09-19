import Link from "next/link";
import { TriangleAlertIcon } from "lucide-react";

import { PlatformAction } from "@/authorization/platform/actions";
import { PlatformAuthorizer } from "@/authorization/platform/authorizer";
import type { StrictAuthorizationActor } from "@/authorization";
import PageWrapper from "@/components/page-wrapper";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { SessionService } from "@/lib/auth/session";
import { AppError, AuthenticationError } from "@/lib/errors";
import type { RawSearchParams } from "@/lib/search";
import { SearchPagination } from "@/lib/search/react";

import { assetAdminService } from "@/modules/assets/backend/admin.service";

import { ReconciliationPreviewTable } from "./_components/reconciliation-preview-table";

const PATHNAME = "/admin/assets/reconciliation";

interface Props {
  searchParams: Promise<RawSearchParams>;
}

/**
 * Admin Asset reconciliation console.
 *
 * Same shape as `/admin/competitions/lifecycle`: the preview runs here
 * against the URL (so it's bookmarkable/shareable), and only the table's
 * interactive parts (selection, apply) are a client component underneath
 * it. Every row shown is a real candidate `AssetReconciliationService
 * .previewCandidates` found — see that method's doc comment on how it
 * stays read-only and never lists an Asset that isn't a genuine candidate.
 */
export default async function AdminAssetReconciliationPage({ searchParams }: Props) {
  const params = await searchParams;

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

  PlatformAuthorizer.can({ actor: strictActor }, PlatformAction.MANAGE_MEDIA);

  let previewOutcome:
    | { status: "fulfilled"; value: Awaited<ReturnType<typeof assetAdminService.previewReconciliation>> }
    | { status: "rejected"; reason: unknown };

  try {
    previewOutcome = {
      status: "fulfilled",
      value: await assetAdminService.previewReconciliation(strictActor, params),
    };
  } catch (error) {
    previewOutcome = { status: "rejected", reason: error };
  }

  if (previewOutcome.status === "rejected") {
    return (
      <Shell>
        <PreviewFailure error={previewOutcome.reason} />
      </Shell>
    );
  }

  const { items, pagination, summary } = previewOutcome.value;

  return (
    <Shell summary={summary}>
      {items.length === 0 ? (
        <EmptyResults />
      ) : (
        <ReconciliationPreviewTable key={JSON.stringify(params)} rows={items} />
      )}

      <SearchPagination
        pagination={pagination}
        params={params}
        pathname={PATHNAME}
        className="pt-2"
      />
    </Shell>
  );
}

function Shell({
  summary,
  children,
}: {
  summary?: {
    unreferencedActive: number;
    detachedAwaitingCleanup: number;
    deletingRetry: number;
    abandonedIntents: number;
  };
  children: React.ReactNode;
}) {
  return (
    <PageWrapper
      breadcrumbs={[
        { label: "Assets", href: "/admin/assets" },
        { label: "Reconciliation", href: PATHNAME },
      ]}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <h1 className="text-4xl font-bold tracking-tight">Asset reconciliation</h1>
          <p className="max-w-2xl text-muted-foreground">
            Assets a background sweep would clean up: unreferenced uploads
            past their grace period, detached assets awaiting deletion, and
            failed deletions eligible for retry. Nothing here has been
            applied yet — review the candidates, select the ones you want,
            and confirm. Each one is re-checked against current state at the
            moment you apply.
          </p>
        </div>

        <Button asChild variant="outline">
          <Link href="/admin/assets">Back to assets</Link>
        </Button>
      </div>

      {summary && (
        <p className="text-sm text-muted-foreground" role="status" aria-live="polite">
          {summary.unreferencedActive} unreferenced · {summary.detachedAwaitingCleanup}{" "}
          awaiting cleanup · {summary.deletingRetry} pending retry
          {summary.abandonedIntents > 0 &&
            ` · ${summary.abandonedIntents} abandoned upload${summary.abandonedIntents === 1 ? "" : "s"} (handled automatically, not shown below)`}
        </p>
      )}

      {children}
    </PageWrapper>
  );
}

function PreviewFailure({ error }: { error: unknown }) {
  const isKnown = error instanceof AppError;
  const message = isKnown
    ? error.message
    : "Something went wrong while loading the reconciliation preview.";

  if (!isKnown) {
    console.error("Asset reconciliation preview failed.", error);
  }

  return (
    <Alert variant="destructive">
      <TriangleAlertIcon />
      <AlertTitle>{message}</AlertTitle>
      <AlertDescription>
        <Button asChild size="sm" variant="outline">
          <Link href={PATHNAME}>Try again</Link>
        </Button>
      </AlertDescription>
    </Alert>
  );
}

function EmptyResults() {
  return (
    <Empty className="border">
      <EmptyHeader>
        <EmptyTitle>Nothing to reconcile</EmptyTitle>
        <EmptyDescription>
          No unreferenced, awaiting-cleanup, or retry-eligible assets right
          now.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button asChild variant="outline">
          <Link href="/admin/assets">Back to assets</Link>
        </Button>
      </EmptyContent>
    </Empty>
  );
}
