import type { PlatformRole } from "@/authorization";
import type { SidebarNavSection } from "@/constants/dashboard-sidebar-links";

/**
 * Exact match only. A section/item's own url is "active" solely when the
 * current pathname equals it exactly — a descendant route belongs to the
 * deepest item that exactly matches it, not to every ancestor whose url
 * happens to be a string prefix (e.g. `/projects` must not light up for
 * `/projects/new`).
 */
export function isExactRouteMatch(pathname: string, url: string): boolean {
  return pathname === url;
}

/**
 * True when the pathname is a descendant path of `url` (a real path-segment
 * child, not merely a shared prefix — `/projects` does not match
 * `/projects-archive`). Used only to decide whether a parent section should
 * stay open, never to decide which single item is "the" active leaf.
 */
export function isDescendantRoute(pathname: string, url: string): boolean {
  return pathname.startsWith(`${url}/`);
}

/** The child item (if any) whose url exactly matches the current pathname. */
export function findActiveChild(pathname: string, section: SidebarNavSection) {
  return section.items?.find((item) => isExactRouteMatch(pathname, item.url));
}

/**
 * Whether a section should be considered "route-active" for auto-open
 * purposes: its own url exactly matches, one of its direct children exactly
 * matches, or the pathname is a deeper descendant of the section (covers
 * future routes not yet represented as an explicit child item).
 */
export function isSectionRouteActive(pathname: string, section: SidebarNavSection): boolean {
  if (section.url && isExactRouteMatch(pathname, section.url)) {
    return true;
  }

  if (findActiveChild(pathname, section)) {
    return true;
  }

  if (section.url && isDescendantRoute(pathname, section.url)) {
    return true;
  }

  return false;
}

/**
 * Frontend-only visibility check. `roles` is a declarative UX hint, not an
 * authorization boundary — the backend enforces access independently.
 * Omitting `roles` means "visible to any authenticated user".
 */
export function isNavItemVisible(
  roles: PlatformRole[] | undefined,
  currentRole: PlatformRole | null | undefined,
): boolean {
  if (!roles) {
    return true;
  }

  if (!currentRole) {
    return false;
  }

  return roles.includes(currentRole);
}
