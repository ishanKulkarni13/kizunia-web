import PageWrapper from "@/components/page-wrapper";
import { BillingPanel } from "@/modules/billing/frontend/components/billing-panel";

const PATHNAME = "/user/billing";

/** The signed-in user's plan and checkout. Everything shown is decided by `GET /api/v1/me/billing`. */
export default function BillingPage() {
  return (
    <PageWrapper breadcrumbs={[{ label: "Billing", href: PATHNAME }]}>
      <div className="m-2 flex flex-col gap-4">
        <BillingPanel />
      </div>
    </PageWrapper>
  );
}
