"use client";

import Link from "next/link";
import { BellIcon } from "lucide-react";

import { Button } from "@/components/ui/button";

import { useUnreadCount } from "../hooks/use-unread-count";

/**
 * The header bell.
 *
 * A link, not a popover. The inbox is a page, and a popover would be a second
 * place the same list is rendered — two implementations of one thing, which is
 * how they drift. The count is the only thing that has to be here.
 */
export function NotificationBell() {
  const unreadCount = useUnreadCount();

  const label =
    unreadCount > 0
      ? `Notifications (${unreadCount} unread)`
      : "Notifications";

  return (
    <Button
      asChild
      variant="ghost"
      size="icon"
      className="relative"
      aria-label={label}
    >
      <Link href="/user/notifications">
        <BellIcon />
        {unreadCount > 0 ? (
          <span
            // aria-hidden because the count is already in the button's label;
            // announcing it twice is worse than not announcing it.
            aria-hidden
            className="absolute -right-0.5 -top-0.5 flex min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-4 text-primary-foreground"
          >
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        ) : null}
      </Link>
    </Button>
  );
}
