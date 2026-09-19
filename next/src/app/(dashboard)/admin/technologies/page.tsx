import { PlatformAction } from "@/authorization/platform/actions";
import { PlatformAuthorizer } from "@/authorization/platform/authorizer";
import type { StrictAuthorizationActor } from "@/authorization";
import PageWrapper from "@/components/page-wrapper";
import { SessionService } from "@/lib/auth/session";
import { AuthenticationError } from "@/lib/errors";

import { TechnologyService } from "@/modules/technologies/backend/service";

import { AdminTechnologiesTable } from "./_components/admin-technologies-table";
import { AdminSummaryStrip } from "./_components/admin-summary-strip";

const PATHNAME = "/admin/technologies";

/**
 * Admin technology management.
 *
 * Mirrors `admin/competitions/page.tsx`'s shape (resolve actor, authorize,
 * fetch server-side, render a summary strip above a client table) but stays
 * much simpler: Technology has no per-resource role system, no URL-driven
 * filter grid, and its create/edit flows are dialogs rather than dedicated
 * routes, so there is no search-params-driven remount to worry about here —
 * the table owns its own search/filter state client-side and calls
 * `TechnologyApi.search` directly, seeded with this page's initial fetch.
 */
export default async function AdminTechnologiesPage() {
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

  PlatformAuthorizer.can({ actor: strictActor }, PlatformAction.MANAGE_TECHNOLOGIES);

  const [searchResult, summary] = await Promise.all([
    TechnologyService.search(strictActor, { limit: "100" }),
    TechnologyService.getAdminSummary(),
  ]);

  return (
    <PageWrapper breadcrumbs={[{ label: "Technologies", href: PATHNAME }]}>
      <div className="space-y-2">
        <h1 className="text-4xl font-bold tracking-tight">Technologies</h1>
        <p className="max-w-2xl text-muted-foreground">
          The global technology taxonomy shared across Projects, Competitions
          and Portfolios.
        </p>
      </div>

      <AdminSummaryStrip summary={summary} />

      <AdminTechnologiesTable initialItems={searchResult.items} />
    </PageWrapper>
  );
}
