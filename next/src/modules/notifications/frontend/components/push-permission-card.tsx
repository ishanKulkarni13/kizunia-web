"use client";

import { BellRingIcon, MonitorSmartphoneIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

import { usePushRegistration } from "../hooks/use-push-registration";

/** Why push cannot work here, in words a user can act on. */
const UNSUPPORTED_COPY: Record<string, string> = {
  "no-service-worker":
    "This browser does not support background notifications. Private or incognito windows usually block them.",
  "no-notification-api":
    "This browser cannot show notifications. On iPhone and iPad, add Kizunia to your home screen first — Safari only delivers notifications to installed apps.",
  "not-configured":
    "Push notifications are not configured for this deployment yet. You will still get everything in your inbox.",
  "no-window": "Push notifications are not available here.",
};

export function PushPermissionCard() {
  const { status, reason, subscriptions, error, enable, revoke } =
    usePushRegistration();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Browser notifications</CardTitle>
        <CardDescription>
          Get notified even when Kizunia is not open. Everything still arrives
          in your inbox either way — this only controls the pop-up.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {status === "checking" ? <Skeleton className="h-10 w-full" /> : null}

        {status === "unsupported" ? (
          <p className="text-sm text-muted-foreground">
            {UNSUPPORTED_COPY[reason ?? "no-window"] ??
              "Push notifications are not available in this browser."}
          </p>
        ) : null}

        {status === "denied" ? (
          <p className="text-sm text-muted-foreground">
            {/* Deliberately not a button. The browser will not show the prompt
                again, so offering one would be offering something that cannot
                work. */}
            You have blocked notifications for Kizunia. To turn them back on,
            allow notifications for this site in your browser settings, then
            reload this page.
          </p>
        ) : null}

        {status === "available" || status === "working" ? (
          <Button onClick={() => void enable()} disabled={status === "working"}>
            <BellRingIcon />
            {status === "working" ? "Enabling…" : "Enable browser notifications"}
          </Button>
        ) : null}

        {status === "enabled" ? (
          <p className="text-sm text-muted-foreground">
            This browser is set up for notifications.
          </p>
        ) : null}

        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}

        {subscriptions.length > 0 ? (
          <div className="space-y-2">
            <p className="text-sm font-medium">Devices receiving notifications</p>
            <ul className="space-y-2">
              {subscriptions.map((subscription) => (
                <li
                  key={subscription.id}
                  className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <MonitorSmartphoneIcon className="size-4 shrink-0 text-muted-foreground" />
                    <span className="truncate text-sm text-muted-foreground">
                      {subscription.userAgent ?? "Unknown device"}
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void revoke(subscription.id)}
                  >
                    Turn off
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
