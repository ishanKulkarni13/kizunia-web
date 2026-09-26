import { PlatformAction } from "@/authorization/platform/actions";
import { PlatformAuthorizer } from "@/authorization/platform/authorizer";
import PageWrapper from "@/components/page-wrapper";
import { SessionService } from "@/lib/auth/session";

import { BillingOverview } from "@/modules/billing/frontend/components/billing-overview";

/**
 * Billing operations home (Phase VIII): look a user up, see whether billing is
 * healthy, and (SUPER_ADMIN, as the server reports) re-sync in bulk.
 *
 * Viewing needs VIEW_BILLING (ADMIN, SUPER_ADMIN). Every mutation is
 * re-authorized by its API; the page only reflects the server's permission flags.
 */
export default async function AdminBillingPage() {
  const actor = await SessionService.getStrictActor();

  PlatformAuthorizer.can({ actor }, PlatformAction.VIEW_BILLING);

  return (
    <PageWrapper breadcrumbs={[{ label: "Billing", href: "/admin/billing" }]}>
      <div className="m-2 flex flex-col gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Billing operations</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Is billing healthy, and what happened to a user&apos;s subscription? Everything here is read from
            Kizunia&apos;s own records; changes to a subscription are made at Razorpay through the tools on a user&apos;s page.
          </p>
        </div>

        <BillingOverview />
      </div>
    </PageWrapper>
  );
}
