"use client"

import * as React from "react"
import { usePathname } from "next/navigation"
import Link from "next/link"

import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar'
import { SideBarNavSecondary } from "@/constants/dashboard-sidebar-links";
import { isExactRouteMatch } from "./nav-utils";

export function NavSecondary({
  ...props
}: React.ComponentPropsWithoutRef<typeof SidebarGroup>) {
  const pathname = usePathname();
  const { isMobile, setOpenMobile } = useSidebar();

  const handleNavigate = () => {
    if (isMobile) {
      setOpenMobile(false);
    }
  };

  return (
    <SidebarGroup {...props}>
      <SidebarGroupContent>
        <SidebarMenu>
          {SideBarNavSecondary.map((item) => {
            const isActive = !!item.url && isExactRouteMatch(pathname, item.url);
            return (
              <SidebarMenuItem key={item.id}>
                <SidebarMenuButton asChild isActive={isActive}>
                  <Link
                    href={item.url ?? "#"}
                    onClick={handleNavigate}
                    aria-current={isActive ? "page" : undefined}
                  >
                    <item.icon />
                    <span>{item.title}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}
