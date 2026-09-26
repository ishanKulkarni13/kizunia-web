import { PlatformAction } from "@/authorization/platform/actions";
import { PlatformAuthorizer } from "@/authorization/platform/authorizer";
import PageWrapper from "@/components/page-wrapper";
import { SessionService } from "@/lib/auth/session";

import { UserBillingView } from "@/modules/billing/frontend/components/user-billing-view";

interface Props {
  params: Promise<{ id: string }>;
}

/**
 * One user's billing: why they have their access, sync now and (SUPER_ADMIN)
 * immediate cancel, and the timeline. VIEW_BILLING to view; each action is
 * re-authorized by its API.
 */
export default async function AdminBillingUserPage({ params }: Props) {
  const { id } = await params;
  const actor = await SessionService.getStrictActor();

  PlatformAuthorizer.can({ actor }, PlatformAction.VIEW_BILLING);

  return (
    <PageWrapper
      breadcrumbs={[
        { label: "Billing", href: "/admin/billing" },
        { label: "User", href: `/admin/billing/users/${encodeURIComponent(id)}` },
      ]}
    >
      <div className="m-2 flex flex-col gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">User billing</h1>

        <UserBillingView userId={id} />
      </div>
    </PageWrapper>
  );
}
