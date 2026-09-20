"use client";

import Link from "next/link";
import { BellIcon, CheckCheckIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import type { NotificationDTO } from "../../types/notification.dto";
import { useNotificationInbox } from "../hooks/use-notification-inbox";

/** Relative time, without pulling in a date library for four cases. */
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const minutes = Math.round((Date.now() - then) / 60_000);

  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)}h ago`;
  if (minutes < 60 * 24 * 7) return `${Math.round(minutes / (60 * 24))}d ago`;

  return new Date(iso).toLocaleDateString();
}

interface NotificationRowProps {
  readonly notification: NotificationDTO;
  readonly onOpen: (id: string) => void;
  readonly onMarkRead: (id: string) => void;
}

function NotificationRow({
  notification,
  onOpen,
  onMarkRead,
}: NotificationRowProps) {
  const unread = notification.readAt === null;

  const body = (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <div className="flex items-center gap-2">
        {/* The unread marker is a dot *and* a weight change: colour alone is
            not a signal everyone can see. */}
        {unread ? (
          <span
            aria-hidden
            className="size-2 shrink-0 rounded-full bg-primary"
          />
        ) : null}
        <p
          className={cn(
            "truncate text-sm",
            unread ? "font-semibold" : "font-medium text-muted-foreground",
          )}
        >
          {notification.title}
        </p>
      </div>
      <p className="text-sm text-muted-foreground">{notification.body}</p>
      <p className="text-xs text-muted-foreground">
        {relativeTime(notification.createdAt)}
        {unread ? <span className="sr-only"> (unread)</span> : null}
      </p>
    </div>
  );

  return (
    <li
      className={cn(
        "flex items-start gap-3 rounded-lg border px-4 py-3 transition-colors",
        unread ? "bg-accent/40" : "bg-transparent",
      )}
    >
      {notification.actionPath ? (
        <Link
          href={notification.actionPath}
          onClick={() => onOpen(notification.id)}
          className="flex min-w-0 flex-1 items-start gap-3 outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md"
        >
          {body}
        </Link>
      ) : (
        body
      )}

      {unread ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onMarkRead(notification.id)}
          aria-label={`Mark "${notification.title}" as read`}
        >
          Mark read
        </Button>
      ) : null}
    </li>
  );
}

export function NotificationList({ compact = false }: { compact?: boolean }) {
  const {
    items,
    unreadCount,
    nextCursor,
    isLoading,
    isLoadingMore,
    error,
    loadMore,
    markRead,
    markAllRead,
    markResponded,
  } = useNotificationInbox(compact ? 8 : 20);

  if (isLoading) {
    return (
      <div className="space-y-2" aria-busy="true" aria-label="Loading notifications">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <BellIcon />
          </EmptyMedia>
          <EmptyTitle>Could not load your notifications</EmptyTitle>
          <EmptyDescription>{error}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  if (items.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <BellIcon />
          </EmptyMedia>
          <EmptyTitle>Nothing here yet</EmptyTitle>
          <EmptyDescription>
            {/* Honest about why it is empty. "No notifications" alone reads as
                a fault; this says what to do about it. */}
            When Kizunia finds a competition that matches your interests, or a
            deadline is approaching, it will show up here. You can choose what
            you hear about in notification preferences.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {unreadCount > 0 ? (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            {unreadCount} unread
          </p>
          <Button variant="ghost" size="sm" onClick={() => void markAllRead()}>
            <CheckCheckIcon />
            Mark all read
          </Button>
        </div>
      ) : null}

      <ul className="flex flex-col gap-2">
        {items.map((notification) => (
          <NotificationRow
            key={notification.id}
            notification={notification}
            onOpen={(id) => void markResponded(id)}
            onMarkRead={(id) => void markRead(id)}
          />
        ))}
      </ul>

      {nextCursor ? (
        <Button
          variant="outline"
          onClick={loadMore}
          disabled={isLoadingMore}
          className="self-center"
        >
          {isLoadingMore ? "Loading…" : "Load more"}
        </Button>
      ) : null}
    </div>
  );
}
