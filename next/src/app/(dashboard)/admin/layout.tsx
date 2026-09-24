import type { Metadata } from "next";

import { PlatformAction } from "@/authorization/platform/actions";
import { PlatformAuthorizer } from "@/authorization/platform/authorizer";
import { SessionService } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: {
    default: "Admin",
    template: "%s | Admin",
  },
  robots: {
    index: false,
    follow: false,
  },
};

/**
 * Admin route-group guard.
 *
 * Every page under /admin renders only after the visitor is authenticated
 * and holds ACCESS_ADMIN_DASHBOARD. Failures throw — `AuthenticationError`
 * from `getStrictActor`, `ForbiddenError` from `PlatformAuthorizer` — and
 * propagate to the nearest error boundary, the established convention
 * under `(dashboard)`; this layout never `redirect()`s.
 *
 * This is the page-shell guard only. Pages with a more specific capability
 * (e.g. `MANAGE_MEDIA`, `MANAGE_TECHNOLOGIES`) keep their own fine-grained
 * `PlatformAuthorizer.can(...)` call — that checks a different, more
 * specific action and is not made redundant by this one. Every mutating API
 * route re-authorizes independently regardless of what renders here.
 *
 * Note: `getStrictActor` does not itself reject a banned actor. A banned
 * admin is still blocked here, via `PlatformPolicy`'s own
 * `.security(!actor.banned, ACCOUNT_BANNED)` check that runs before its
 * permission lookup — just as `ForbiddenError(ACCOUNT_BANNED)`, not
 * `AuthenticationError`.
 */
export default async function AdminLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const actor = await SessionService.getStrictActor();

  PlatformAuthorizer.can({ actor }, PlatformAction.ACCESS_ADMIN_DASHBOARD);

  return children;
}