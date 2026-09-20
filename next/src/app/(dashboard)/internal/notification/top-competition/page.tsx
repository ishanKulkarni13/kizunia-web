import { AuthenticationError } from "@/lib/errors";
import { SessionService } from "@/lib/auth/session";
import PageWrapper from "@/components/page-wrapper";

import { RecommendationDebugPanel } from "./_components/recommendation-debug-panel";

const PATHNAME = "/internal/notification/top-competition";

/**
 * Temporary developer testing surface for the Phase 0 recommendation
 * engine — see `docs/architecture/recommendation/testing.md`.
 *
 * Authenticated, but deliberately NOT admin-gated (no `PlatformAuthorizer`
 * check): every signed-in user may exercise the engine against their own
 * account. There is no way to request another user's recommendations —
 * `RecommendationController` always uses the session's own `userId`.
 *
 * This page and its client panel contain zero scoring/ranking logic; they
 * only call `RecommendationApi.generateForCurrentUser` and render the
 * result. No notification is created, no history is written, no queue is
 * touched.
 */
export default async function TopCompetitionDebugPage() {
  const actor = await SessionService.getActor();

  if (!actor || !actor.id) {
    throw new AuthenticationError({
      code: "UNAUTHORIZED",
      message: "You must be signed in to use this page.",
      status: 401,
    });
  }

  return (
    <PageWrapper breadcrumbs={[{ label: "Top Competition (Debug)", href: PATHNAME }]}>
      <div className="space-y-2">
        <h1 className="text-4xl font-bold tracking-tight">
          Recommendation Engine — Debug
        </h1>
        <p className="max-w-2xl text-muted-foreground">
          Temporary internal testing surface for the Phase 0 recommendation
          engine. Runs the pipeline for your own account and shows the full
          scoring breakdown. Nothing here creates a notification.
        </p>
      </div>

      <RecommendationDebugPanel />
    </PageWrapper>
  );
}
