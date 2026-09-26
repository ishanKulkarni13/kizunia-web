import { PlatformAction } from "@/authorization/platform/actions";
import { PlatformAuthorizer } from "@/authorization/platform/authorizer";
import PageWrapper from "@/components/page-wrapper";
import { SessionService } from "@/lib/auth/session";

import { AnomalyDetail } from "@/modules/billing/frontend/components/anomaly-detail";

interface Props {
  params: Promise<{ id: string }>;
}

/** One anomaly. VIEW_BILLING to read; resolving needs MANAGE_BILLING (SUPER_ADMIN), enforced by the API. */
export default async function AdminBillingAnomalyPage({ params }: Props) {
  const { id } = await params;
  const actor = await SessionService.getStrictActor();

  PlatformAuthorizer.can({ actor }, PlatformAction.VIEW_BILLING);

  return (
    <PageWrapper
      breadcrumbs={[
        { label: "Billing", href: "/admin/billing" },
        { label: "Anomalies", href: "/admin/billing/anomalies" },
        { label: "Anomaly", href: `/admin/billing/anomalies/${encodeURIComponent(id)}` },
      ]}
    >
      <div className="m-2 flex flex-col gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Anomaly</h1>

        <AnomalyDetail anomalyId={id} />
      </div>
    </PageWrapper>
  );
}
