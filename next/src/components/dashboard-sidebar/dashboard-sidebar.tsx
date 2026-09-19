"use client";

import * as React from "react";
import { ArrowUpCircleIcon } from "lucide-react";

import { NavMain } from "@/components/dashboard-sidebar/nav-main";
import { NavSecondary } from "@/components/dashboard-sidebar/nav-secondary";
import { NavUser } from "@/components/dashboard-sidebar/nav-user";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import Link from "next/link";
import { WebsiteLogo } from "../icons/WebsiteLogo";

export function DashboardSidebar({
  ...props
}: React.ComponentProps<typeof Sidebar>) {


  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              className="data-[slot=sidebar-menu-button]:!p-1.5"
            >
              <Link href="/">
                {/* <ArrowUpCircleIcon /> */}
                <WebsiteLogo  />
                <span className="text-base font-semibold">Kizunia</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain />
        <NavSecondary className="mt-auto" />
      </SidebarContent>
      <SidebarFooter>
        <NavUser />
      </SidebarFooter>
    </Sidebar>
  );
}
