import { NotificationPreferencesCard } from "@/components/preferences/notification-preferences-card";
import PageWrapper from "@/components/page-wrapper";

export default function NotificationPreferencesPage() {
  return (
    <PageWrapper breadcrumbs={[]}>
      <div className="m-2 flex flex-col justify-stretch items-stretch gap-2">
        <NotificationPreferencesCard />
      </div>
    </PageWrapper>
  );
}
