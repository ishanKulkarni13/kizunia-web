import { PlatformAction } from "@/authorization/platform/actions";
import { PlatformAuthorizer } from "@/authorization/platform/authorizer";
import PageWrapper from "@/components/page-wrapper";
import { SessionService } from "@/lib/auth/session";

import { PromotionManager } from "@/modules/billing/frontend/components/promotion-manager";

const PATHNAME = "/admin/billing/promotions";

/**
 * Admin promotions.
 *
 * Creating and listing need MANAGE_ENTITLEMENT_GRANTS (SUPER_ADMIN only): the
 * one permission for promotions, enforced by the API and checked here so
 * others do not see a page that would only refuse them.
 */
export default async function AdminPromotionsPage() {
  const actor = await SessionService.getStrictActor();

  PlatformAuthorizer.can({ actor }, PlatformAction.MANAGE_ENTITLEMENT_GRANTS);

  return (
    <PageWrapper breadcrumbs={[{ label: "Promotions", href: PATHNAME }]}>
      <div className="m-2 flex flex-col gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Promotions</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Free plan access redeemed with a code, once per user and never beyond its limit. Each
            redemption creates an entitlement grant, recorded like any other.
          </p>
        </div>

        <PromotionManager />
      </div>
    </PageWrapper>
  );
}
