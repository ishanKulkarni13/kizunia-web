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
import { NotificationPreferenceApi } from "@/modules/preferences/api/notification-preference-api";

const TOP_RELEVANT_COMPETITION = "TOP_RELEVANT_COMPETITION" as const;

export function NotificationPreferencesCard() {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;

    NotificationPreferenceApi.list()
      .then((preferences) => {
        if (cancelled) return;
        const entry = preferences.find(
          (p) => p.intent === TOP_RELEVANT_COMPETITION,
        );
        setEnabled(entry?.enabled ?? false);
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

  async function handleToggle(next: boolean) {
    const previous = enabled;
    setEnabled(next);
    setSaving(true);

    try {
      await NotificationPreferenceApi.update(TOP_RELEVANT_COMPETITION, next);
      toast.success("Notification preference saved.");
    } catch (error) {
      setEnabled(previous);
      toast.error(
        error instanceof ApiError ? error.message : "Failed to save.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Notification Preferences</CardTitle>
        <CardDescription>
          Choose which notifications Kizunia sends you.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-10 w-full" />
        ) : (
          <div className="flex items-center justify-between gap-4 rounded-lg border px-4 py-3">
            <div className="space-y-0.5">
              <p className="text-sm font-medium">Competition Recommendations</p>
              <p className="text-sm text-muted-foreground">
                Get notified when Kizunia finds competitions that match your
                interests.
              </p>
            </div>
            <Switch
              checked={enabled}
              disabled={saving}
              onCheckedChange={handleToggle}
              aria-label="Toggle competition recommendation notifications"
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
