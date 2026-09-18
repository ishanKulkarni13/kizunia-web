"use client";

import { useCallback, useEffect, useState } from "react";

import { ApiError } from "@/lib/http";

import { NotificationApi } from "../../api/notification-api";
import type { NotificationDTO } from "../../types/notification.dto";

interface InboxState {
  readonly items: readonly NotificationDTO[];
  readonly unreadCount: number;
  readonly nextCursor: string | null;
  readonly isLoading: boolean;
  readonly isLoadingMore: boolean;
  readonly error: string | null;
}

const INITIAL: InboxState = {
  items: [],
  unreadCount: 0,
  nextCursor: null,
  isLoading: true,
  isLoadingMore: false,
  error: null,
};

export interface UseNotificationInbox extends InboxState {
  readonly loadMore: () => void;
  readonly markRead: (id: string) => Promise<void>;
  readonly markAllRead: () => Promise<void>;
  readonly markResponded: (id: string) => Promise<void>;
  readonly reload: () => void;
}

/**
 * The inbox, with optimistic read state.
 *
 * Read state is updated locally before the request completes, because the
 * alternative — waiting for a round trip before the row stops looking unread —
 * makes the click feel broken. It is reverted on failure.
 *
 * Note it does *not* re-fetch after marking read. The server's answer would be
 * identical to what is already on screen, and re-fetching would reorder or
 * re-page the list under someone who is in the middle of reading it.
 */
export function useNotificationInbox(pageSize = 20): UseNotificationInbox {
  const [state, setState] = useState<InboxState>(INITIAL);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setState((previous) => ({ ...previous, isLoading: true, error: null }));

      try {
        const page = await NotificationApi.list({ limit: pageSize });

        if (cancelled) return;

        setState({
          items: page.items,
          unreadCount: page.unreadCount,
          nextCursor: page.nextCursor,
          isLoading: false,
          isLoadingMore: false,
          error: null,
        });
      } catch (error) {
        if (cancelled) return;

        setState({
          ...INITIAL,
          isLoading: false,
          error:
            error instanceof ApiError
              ? error.message
              : "Failed to load your notifications.",
        });
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [pageSize, reloadToken]);

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  const loadMore = useCallback(() => {
    setState((previous) => {
      if (!previous.nextCursor || previous.isLoadingMore) return previous;

      const cursor = previous.nextCursor;

      void (async () => {
        try {
          const page = await NotificationApi.list({ limit: pageSize, cursor });

          setState((current) => ({
            ...current,
            // Appended, not replaced: the earlier pages are what the user is
            // currently looking at.
            items: [...current.items, ...page.items],
            nextCursor: page.nextCursor,
            unreadCount: page.unreadCount,
            isLoadingMore: false,
          }));
        } catch (error) {
          setState((current) => ({
            ...current,
            isLoadingMore: false,
            error:
              error instanceof ApiError
                ? error.message
                : "Failed to load more notifications.",
          }));
        }
      })();

      return { ...previous, isLoadingMore: true };
    });
  }, [pageSize]);

  const markRead = useCallback(async (id: string) => {
    let wasUnread = false;

    setState((previous) => {
      const items = previous.items.map((item) => {
        if (item.id !== id || item.readAt) return item;
        wasUnread = true;
        return { ...item, readAt: new Date().toISOString() };
      });

      return {
        ...previous,
        items,
        unreadCount: wasUnread
          ? Math.max(0, previous.unreadCount - 1)
          : previous.unreadCount,
      };
    });

    if (!wasUnread) return;

    try {
      await NotificationApi.markRead(id);
    } catch {
      // Put it back. A row that silently stays "read" after a failed save is
      // worse than one that visibly reverts.
      setState((previous) => ({
        ...previous,
        items: previous.items.map((item) =>
          item.id === id ? { ...item, readAt: null } : item,
        ),
        unreadCount: previous.unreadCount + 1,
      }));
    }
  }, []);

  const markAllRead = useCallback(async () => {
    const snapshot = state.items;

    setState((previous) => ({
      ...previous,
      items: previous.items.map((item) =>
        item.readAt ? item : { ...item, readAt: new Date().toISOString() },
      ),
      unreadCount: 0,
    }));

    try {
      await NotificationApi.markAllRead();
    } catch {
      setState((previous) => ({
        ...previous,
        items: snapshot,
        unreadCount: snapshot.filter((item) => !item.readAt).length,
      }));
    }
  }, [state.items]);

  const markResponded = useCallback(
    async (id: string) => {
      // Opening the action implies having seen it, so both move together —
      // leaving it unread after the user clicked through would be visibly
      // wrong. The server applies the same rule.
      setState((previous) => ({
        ...previous,
        items: previous.items.map((item) =>
          item.id === id
            ? {
                ...item,
                readAt: item.readAt ?? new Date().toISOString(),
                respondedAt: item.respondedAt ?? new Date().toISOString(),
              }
            : item,
        ),
        unreadCount: previous.items.some(
          (item) => item.id === id && !item.readAt,
        )
          ? Math.max(0, previous.unreadCount - 1)
          : previous.unreadCount,
      }));

      try {
        await NotificationApi.markResponded(id);
      } catch {
        // Deliberately not reverted. The user is already navigating away, and
        // a row flickering back to unread behind them would be confusing for
        // no benefit — the next load reconciles it.
      }
    },
    [],
  );

  return { ...state, loadMore, markRead, markAllRead, markResponded, reload };
}
