"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";
import Link from "next/link";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { SideBarNavMain, type SidebarNavSection } from "@/constants/dashboard-sidebar-links";
import { authClient } from "@/lib/auth-client";
import type { PlatformRole } from "@/authorization";
import { isExactRouteMatch, isNavItemVisible, isSectionRouteActive } from "./nav-utils";

export function NavMain() {
  const pathname = usePathname();
  const { isMobile, setOpenMobile } = useSidebar();
  const currentSessionData = authClient.useSession();
  const currentRole = currentSessionData.data?.user.role as PlatformRole | undefined;

  const [openOverrides, setOpenOverrides] = useState<Record<string, boolean>>({});
  const activeSectionId = SideBarNavMain.find((section) =>
    isSectionRouteActive(pathname, section),
  )?.id;

  // Reset manual open/close overrides whenever the route-active section
  // changes, so navigating to a different section re-opens it even if the
  // user had previously collapsed it — without persisting router state.
  const [trackedActiveSectionId, setTrackedActiveSectionId] = useState(activeSectionId);
  if (activeSectionId !== trackedActiveSectionId) {
    setTrackedActiveSectionId(activeSectionId);
    setOpenOverrides({});
  }

  const handleNavigate = () => {
    if (isMobile) {
      setOpenMobile(false);
    }
  };

  const handleOpenChange = (sectionId: string, open: boolean) => {
    setOpenOverrides((prev) => ({ ...prev, [sectionId]: open }));
  };

  const visibleSections = SideBarNavMain.filter((section) =>
    isNavItemVisible(section.roles, currentRole),
  );

  return (
    <SidebarGroup>
      <SidebarGroupLabel>Platform</SidebarGroupLabel>
      <SidebarMenu>
        {visibleSections.map((section) => (
          <NavMainSection
            key={section.id}
            section={section}
            pathname={pathname}
            currentRole={currentRole}
            open={openOverrides[section.id] ?? isSectionRouteActive(pathname, section)}
            onOpenChange={(open) => handleOpenChange(section.id, open)}
            onNavigate={handleNavigate}
          />
        ))}
      </SidebarMenu>
    </SidebarGroup>
  );
}

function NavMainSection({
  section,
  pathname,
  currentRole,
  open,
  onOpenChange,
  onNavigate,
}: {
  section: SidebarNavSection;
  pathname: string;
  currentRole: PlatformRole | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNavigate: () => void;
}) {
  const visibleItems = section.items?.filter((item) =>
    isNavItemVisible(item.roles, currentRole),
  );
  const hasChildren = !!visibleItems?.length;
  const isSectionLinkActive = !!section.url && isExactRouteMatch(pathname, section.url);

  // A: leaf link only.
  if (section.url && !hasChildren) {
    return (
      <SidebarMenuItem>
        <SidebarMenuButton asChild isActive={isSectionLinkActive} tooltip={section.title}>
          <Link
            href={section.url}
            onClick={onNavigate}
            aria-current={isSectionLinkActive ? "page" : undefined}
          >
            <section.icon />
            <span>{section.title}</span>
          </Link>
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  }

  // B / C: expandable, optionally also navigable via its own url.
  return (
    <Collapsible
      asChild
      open={open}
      onOpenChange={onOpenChange}
      className="group/collapsible"
    >
      <SidebarMenuItem>
        {section.url ? (
          <SidebarMenuButton asChild isActive={isSectionLinkActive} tooltip={section.title}>
            <Link
              href={section.url}
              onClick={onNavigate}
              aria-current={isSectionLinkActive ? "page" : undefined}
            >
              <section.icon />
              <span>{section.title}</span>
            </Link>
          </SidebarMenuButton>
        ) : (
          <CollapsibleTrigger asChild>
            <SidebarMenuButton tooltip={section.title}>
              <section.icon />
              <span>{section.title}</span>
              <ChevronRight className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
            </SidebarMenuButton>
          </CollapsibleTrigger>
        )}

        {section.url && (
          <CollapsibleTrigger asChild>
            <SidebarMenuAction aria-label={`Toggle ${section.title} section`}>
              <ChevronRight className="transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
            </SidebarMenuAction>
          </CollapsibleTrigger>
        )}

        <CollapsibleContent>
          <SidebarMenuSub>
            {visibleItems?.map((item) => {
              const isItemActive = isExactRouteMatch(pathname, item.url);
              return (
                <SidebarMenuSubItem key={item.id}>
                  <SidebarMenuSubButton asChild isActive={isItemActive}>
                    <Link
                      href={item.url}
                      onClick={onNavigate}
                      aria-current={isItemActive ? "page" : undefined}
                    >
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuSubButton>
                </SidebarMenuSubItem>
              );
            })}
          </SidebarMenuSub>
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  );
}
