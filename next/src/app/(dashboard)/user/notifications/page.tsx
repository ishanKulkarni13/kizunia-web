import PageWrapper from "@/components/page-wrapper";
import { NotificationList } from "@/modules/notifications/frontend/components/notification-list";

export default function NotificationsPage() {
  return (
    <PageWrapper breadcrumbs={[{ label: "Notifications", href: "/user/notifications" }]}>
      <div className="m-2 flex max-w-3xl flex-col gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Notifications</h1>
          <p className="text-sm text-muted-foreground">
            Everything Kizunia has told you, newest first.
          </p>
        </div>

        <NotificationList />
      </div>
    </PageWrapper>
  );
}
