import PageWrapper from "@/components/page-wrapper";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <PageWrapper
      breadcrumbs={[
        { label: "Announcements", href: "/admin/notification-announcements" },
      ]}
    >
      <div className="m-2 flex max-w-3xl flex-col gap-4">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    </PageWrapper>
  );
}
