import { PlatformAction } from "@/authorization/platform/actions";
import { PlatformAuthorizer } from "@/authorization/platform/authorizer";
import PageWrapper from "@/components/page-wrapper";
import { SessionService } from "@/lib/auth/session";

import { AnomalyList } from "@/modules/billing/frontend/components/anomaly-list";

interface Props {
  searchParams: Promise<{ type?: string; status?: string }>;
}

const STATUSES = ["OPEN", "RESOLVED", "ALL"] as const;

/**
 * Billing anomalies: situations that need a human decision. Alerts and the
 * health summary link here (`?type=`). VIEW_BILLING to read; SUPER_ADMIN
 * resolves, on the detail page.
 */
export default async function AdminBillingAnomaliesPage({ searchParams }: Props) {
  const query = await searchParams;
  const actor = await SessionService.getStrictActor();

  PlatformAuthorizer.can({ actor }, PlatformAction.VIEW_BILLING);

  const status = STATUSES.find((value) => value === query.status);

  return (
    <PageWrapper
      breadcrumbs={[
        { label: "Billing", href: "/admin/billing" },
        { label: "Anomalies", href: "/admin/billing/anomalies" },
      ]}
    >
      <div className="m-2 flex flex-col gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Billing anomalies</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Things Kizunia noticed but never fixes on its own. Handle the underlying situation, then resolve the
            anomaly with a reason.
          </p>
        </div>

        <AnomalyList initialType={query.type} initialStatus={status} />
      </div>
    </PageWrapper>
  );
}
