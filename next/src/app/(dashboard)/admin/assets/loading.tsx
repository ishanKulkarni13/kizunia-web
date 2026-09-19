import PageWrapper from "@/components/page-wrapper";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <PageWrapper breadcrumbs={[{ label: "Assets", href: "/admin/assets" }]}>
      <Skeleton className="h-9 w-72" />
      <Skeleton className="h-5 w-full max-w-2xl" />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 sm:max-w-2xl">
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>

      <Skeleton className="h-9 w-full" />

      <div className="space-y-2 rounded-md border p-3">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    </PageWrapper>
  );
}
