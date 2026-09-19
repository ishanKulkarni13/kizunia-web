import {
  FileCodeIcon,
  FileUser,
  Trophy,
  UsersIcon,
  type LucideIcon,
} from "lucide-react";
import { PlatformRole } from "@/authorization";

export interface SidebarNavItem {
  id: string;
  title: string;
  url: string;
  /**
   * Roles allowed to see this item. Omit to show it to every authenticated
   * user regardless of role. This is a frontend visibility declaration only —
   * it is not an authorization boundary; the backend enforces access
   * independently.
   */
  roles?: PlatformRole[];
}

export interface SidebarNavSection {
  id: string;
  title: string;
  icon: LucideIcon;
  /**
   * When present, the section label/icon itself is a navigable link.
   * When also combined with `items`, the label/icon navigates while a
   * separate chevron control toggles expansion.
   */
  url?: string;
  /** See SidebarNavItem.roles — same UX-only visibility semantics. */
  roles?: PlatformRole[];
  items?: SidebarNavItem[];
}

export const SideBarNavMain: SidebarNavSection[] = [
  { // competitions
    id: "competitions",
    title: "Competitions",
    url: "/competitions",
    icon: Trophy,
  },
  { // community
    id: "community",
    title: "Community",
    icon: UsersIcon,
    items: [
      {
        id: "community-suggest-competition",
        title: "Suggest Competition",
        url: "/competitions/suggestions/new",
      },
      {
        id: "community-my-suggestions",
        title: "My Suggestions",
        url: "/competitions/suggestions",
      },
    ],
  },
  { // admin
    id: "admin",
    title: "Admin",
    icon: UsersIcon,
    roles: [PlatformRole.ADMIN, PlatformRole.SUPER_ADMIN],
    items: [
      {
        id: "admin-all-competitions",
        title: "All Competitions",
        url: "/admin/competitions",
      },
      {
        id: "admin-new-competition",
        title: "New Competition",
        url: "/admin/competitions/new",
      },
      {
        id: "admin-competition-suggestions",
        title: "Competition Suggestions",
        url: "/admin/competition-suggestions",
      },
      {
        id: "admin-competition-lifecycle",
        title: "Competition lifecycle",
        url: "/admin/competitions/lifecycle",
      },
      {
        id: "admin-assets",
        title: "Assets",
        url: "/admin/assets",
      },
    ],
  },
  { // portfolio
    id: "portfolio",
    title: "Portfolio",
    url: "/portfolio",
    icon: FileUser,
    items: [
      {
        id: "portfolio-profile",
        title: "Profile",
        url: "/portfolio/edit/profile",
      },
    ],
  },
  { // projects
    id: "projects",
    title: "Projects",
    url: "/projects",
    icon: FileCodeIcon,
    items: [
      {
        id: "projects-my-projects",
        title: "My Projects",
        url: "/projects/my-projects",
      },
      {
        id: "projects-new-project",
        title: "New Project",
        url: "/projects/new",
      },
    ],
  },
];

/**
 * Secondary nav (Settings / Get Help / etc). Reserved extension point —
 * intentionally empty until those destinations exist.
 */
export const SideBarNavSecondary: SidebarNavSection[] = [];
