import PageWrapper from "@/components/page-wrapper";
import { AnnouncementComposer } from "@/modules/notifications/frontend/components/announcement-composer";

export default function NotificationAnnouncementsPage() {
  return (
    <PageWrapper
      breadcrumbs={[
        { label: "Announcements", href: "/admin/notification-announcements" },
      ]}
    >
      <div className="m-2 flex max-w-3xl flex-col gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            Platform announcements
          </h1>
          <p className="text-sm text-muted-foreground">
            Tell every Kizunia user about something new.
          </p>
        </div>

        <AnnouncementComposer />
      </div>
    </PageWrapper>
  );
}
