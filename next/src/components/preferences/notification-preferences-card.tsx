"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/lib/http";
import type { NotificationIntent } from "@/generated/prisma";
import { NotificationPreferenceApi } from "@/modules/preferences/api/notification-preference-api";
import {
  NOTIFICATION_INTENT_COPY,
  NOTIFICATION_INTENT_ORDER,
} from "@/modules/preferences/notification-intent-copy";

type PreferenceState = Partial<Record<NotificationIntent, boolean>>;

export function NotificationPreferencesCard() {
  const [preferences, setPreferences] = useState<PreferenceState>({});
  /**
   * Which intents to render, from the API rather than from the enum.
   *
   * Not every intent applies to every account — an operational one is addressed
   * to whoever holds a capability — and the server is the only side that knows
   * which. Rendering `NOTIFICATION_INTENT_ORDER` directly would show a reviewer
   * setting to everyone; rendering the intersection shows it to reviewers and
   * keeps the deliberate ordering for those who do see it.
   */
  const [visibleIntents, setVisibleIntents] = useState<readonly NotificationIntent[]>(
    [],
  );
  const [loading, setLoading] = useState(true);
  const [savingIntent, setSavingIntent] = useState<NotificationIntent | null>(
    null,
  );

  useEffect(() => {
    let cancelled = false;

    NotificationPreferenceApi.list()
      .then((entries) => {
        if (cancelled) return;
        setPreferences(
          Object.fromEntries(
            entries.map((entry) => [entry.intent, entry.enabled]),
          ),
        );

        const returned = new Set(entries.map((entry) => entry.intent));
        setVisibleIntents(
          NOTIFICATION_INTENT_ORDER.filter((intent) => returned.has(intent)),
        );
      })
      .catch(() => {
        if (!cancelled) toast.error("Failed to load notification preferences.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Optimistic, with rollback. A toggle that visibly lags the tap reads as
   * broken; a toggle that silently stays on after a failed save is worse, so
   * the failure path restores the previous value rather than leaving the
   * optimistic one.
   */
  async function handleToggle(intent: NotificationIntent, next: boolean) {
    const previous = preferences[intent] ?? false;
    setPreferences((current) => ({ ...current, [intent]: next }));
    setSavingIntent(intent);

    try {
      await NotificationPreferenceApi.update(intent, next);
      toast.success("Notification preference saved.");
    } catch (error) {
      setPreferences((current) => ({ ...current, [intent]: previous }));
      toast.error(error instanceof ApiError ? error.message : "Failed to save.");
    } finally {
      setSavingIntent(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Notification Preferences</CardTitle>
        <CardDescription>
          Choose which notifications Kizunia sends you. These control what you
          are told about — not which competitions Kizunia considers relevant,
          which is set under Competition Preferences.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <>
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </>
        ) : (
          visibleIntents.map((intent) => {
            const copy = NOTIFICATION_INTENT_COPY[intent];

            return (
              <div
                key={intent}
                className="flex items-start justify-between gap-4 rounded-lg border px-4 py-3"
              >
                <div className="space-y-0.5">
                  <p className="text-sm font-medium">{copy.label}</p>
                  <p className="text-sm text-muted-foreground">
                    {copy.description}
                  </p>
                </div>
                <Switch
                  checked={preferences[intent] ?? false}
                  disabled={savingIntent !== null}
                  onCheckedChange={(next) => handleToggle(intent, next)}
                  aria-label={`Toggle ${copy.label.toLowerCase()}`}
                />
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
