import PageWrapper from "@/components/page-wrapper";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <PageWrapper
      breadcrumbs={[{ label: "Competitions", href: "/admin/competitions" }]}
    >
      <div className="space-y-2">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-5 w-96" />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-16" />
        ))}
      </div>

      <Skeleton className="h-12 w-full" />

      <div className="space-y-2 rounded-md border p-3">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    </PageWrapper>
  );
}
