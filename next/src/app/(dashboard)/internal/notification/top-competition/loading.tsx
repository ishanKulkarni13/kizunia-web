import PageWrapper from "@/components/page-wrapper";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <PageWrapper
      breadcrumbs={[
        { label: "Top Competition (Debug)", href: "/internal/notification/top-competition" },
      ]}
    >
      <Skeleton className="h-9 w-96" />
      <Skeleton className="h-5 w-full max-w-2xl" />

      <Skeleton className="h-9 w-40" />

      <div className="space-y-2 rounded-md border p-3">
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    </PageWrapper>
  );
}
