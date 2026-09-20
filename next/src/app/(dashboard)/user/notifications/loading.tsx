import PageWrapper from "@/components/page-wrapper";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <PageWrapper breadcrumbs={[{ label: "Notifications", href: "/user/notifications" }]}>
      <div className="m-2 flex max-w-3xl flex-col gap-4">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-5 w-80" />

        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      </div>
    </PageWrapper>
  );
}
