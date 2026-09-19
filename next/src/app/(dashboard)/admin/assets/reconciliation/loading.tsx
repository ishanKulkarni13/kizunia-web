import PageWrapper from "@/components/page-wrapper";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <PageWrapper
      breadcrumbs={[
        { label: "Assets", href: "/admin/assets" },
        { label: "Reconciliation", href: "/admin/assets/reconciliation" },
      ]}
    >
      <Skeleton className="h-9 w-72" />
      <Skeleton className="h-5 w-full max-w-2xl" />
      <Skeleton className="h-5 w-64" />

      <div className="space-y-2 rounded-md border p-3">
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    </PageWrapper>
  );
}
