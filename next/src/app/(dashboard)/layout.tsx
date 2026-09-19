
import type { Metadata } from "next";
import { DashboardSidebar } from "@/components/dashboard-sidebar/dashboard-sidebar";
import {
  SidebarInset,
  SidebarProvider,
} from "@/components/ui/sidebar";

export const metadata: Metadata = {
  title: "Dashboard",
  description: "This is your dashboard",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  
  return (
    <>
      <SidebarProvider>
        <DashboardSidebar variant="inset" />
        <SidebarInset>
          {children}
        </SidebarInset>
      </SidebarProvider>
    </>
  );
}
