import Link from "next/link";

import { PlatformAction } from "@/authorization/platform/actions";
import { PlatformAuthorizer } from "@/authorization/platform/authorizer";
import type { StrictAuthorizationActor } from "@/authorization";
import PageWrapper from "@/components/page-wrapper";
import { Button } from "@/components/ui/button";
import { SessionService } from "@/lib/auth/session";
import { AuthenticationError } from "@/lib/errors";

import { assetAdminService } from "@/modules/assets/backend/admin.service";

import { AssetSummaryStrip } from "./_components/asset-summary-strip";
import { AssetAdminTable } from "./_components/asset-admin-table";

const PATHNAME = "/admin/assets";

/**
 * Admin Asset management.
 *
 * Mirrors `admin/technologies/page.tsx`'s shape: resolve actor, authorize
 * independently of the page-level guard (the API routes re-check
 * `MANAGE_MEDIA` themselves — see AssetAuthorizer), fetch server-side for
 * the first paint, then hand off to a client table that owns its own
 * filter/pagination state. Asset, like Technology, has no per-resource role
 * grid and no existing URL-driven filter-spec registry, so this follows
 * Technology's convention rather than Competition Lifecycle's.
 */
export default async function AdminAssetsPage() {
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

  const [searchResult, summary] = await Promise.all([
    assetAdminService.search(strictActor, { limit: "20" }),
    assetAdminService.getSummary(strictActor),
  ]);

  return (
    <PageWrapper breadcrumbs={[{ label: "Assets", href: PATHNAME }]}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <h1 className="text-4xl font-bold tracking-tight">Assets</h1>
          <p className="max-w-2xl text-muted-foreground">
            Every uploaded file across Kizunia — avatars, logos, banners,
            resumes, and more — with what currently references it and its
            lifecycle state.
          </p>
        </div>

        <Button asChild variant="outline">
          <Link href="/admin/assets/reconciliation">Reconciliation</Link>
        </Button>
      </div>

      <AssetSummaryStrip summary={summary} />

      <AssetAdminTable
        initialItems={searchResult.items}
        initialPagination={searchResult.pagination}
      />
    </PageWrapper>
  );
}
