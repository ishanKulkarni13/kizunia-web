import PageWrapper from "@/components/page-wrapper";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <PageWrapper breadcrumbs={[{ label: "Entitlement grants", href: "/admin/billing/grants" }]}>
      <div className="m-2 flex flex-col gap-4">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-10 w-full max-w-xl" />
        <Skeleton className="h-64 w-full" />
      </div>
    </PageWrapper>
  );
}
