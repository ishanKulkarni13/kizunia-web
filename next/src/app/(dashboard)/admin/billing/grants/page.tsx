import { PlatformAction } from "@/authorization/platform/actions";
import { PlatformAuthorizer } from "@/authorization/platform/authorizer";
import PageWrapper from "@/components/page-wrapper";
import { SessionService } from "@/lib/auth/session";

import { GrantManager } from "@/modules/billing/frontend/components/grant-manager";

const PATHNAME = "/admin/billing/grants";

/**
 * Admin entitlement grants.
 *
 * Viewing needs VIEW_BILLING (ADMIN, SUPER_ADMIN); creating, extending and
 * revoking need MANAGE_ENTITLEMENT_GRANTS (SUPER_ADMIN only), enforced by the
 * API — the page only reflects the server's `permissions.canManage`.
 */
export default async function AdminEntitlementGrantsPage() {
  const actor = await SessionService.getStrictActor();

  PlatformAuthorizer.can({ actor }, PlatformAction.VIEW_BILLING);

  return (
    <PageWrapper breadcrumbs={[{ label: "Entitlement grants", href: PATHNAME }]}>
      <div className="m-2 flex flex-col gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Entitlement grants</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Plan access given without payment — for testing, the team, prizes and support. Every
            grant, extension and revocation is recorded with who did it and why.
          </p>
        </div>

        <GrantManager />
      </div>
    </PageWrapper>
  );
}
