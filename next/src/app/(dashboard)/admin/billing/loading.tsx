import PageWrapper from "@/components/page-wrapper";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <PageWrapper breadcrumbs={[{ label: "Billing", href: "/admin/billing" }]}>
      <div className="m-2 flex flex-col gap-4">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-16 w-full max-w-xl" />
        <Skeleton className="h-96 w-full" />
      </div>
    </PageWrapper>
  );
}
