"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { ApiError } from "@/lib/http";

import { AnnouncementApi } from "../../api/announcement-api";
import type { AnnouncementDTO } from "../../backend/announcement.service";

const CANCELLABLE = new Set(["DRAFT", "SCHEDULED", "PUBLISHING"]);

function statusVariant(status: string) {
  if (status === "PUBLISHED") return "default" as const;
  if (status === "CANCELLED") return "destructive" as const;
  return "secondary" as const;
}

export function AnnouncementComposer() {
  const [announcements, setAnnouncements] = useState<AnnouncementDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [url, setUrl] = useState("");
  const [scheduledFor, setScheduledFor] = useState("");

  useEffect(() => {
    let cancelled = false;

    AnnouncementApi.list()
      .then((rows) => {
        if (!cancelled) setAnnouncements(rows);
      })
      .catch((error) => {
        if (!cancelled) {
          toast.error(
            error instanceof ApiError
              ? error.message
              : "Failed to load announcements.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);

    try {
      const created = await AnnouncementApi.create({
        title: title.trim(),
        body: body.trim(),
        url: url.trim() === "" ? undefined : url.trim(),
        // Empty means now. "Send now" is a schedule time of now, not a
        // separate path (ND-I-22).
        scheduledFor:
          scheduledFor === "" ? undefined : new Date(scheduledFor).toISOString(),
      });

      setAnnouncements((previous) => [created, ...previous]);
      setTitle("");
      setBody("");
      setUrl("");
      setScheduledFor("");
      toast.success("Announcement scheduled.");
    } catch (error) {
      toast.error(
        error instanceof ApiError
          ? error.message
          : "Failed to create the announcement.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCancel(id: string) {
    try {
      const cancelled = await AnnouncementApi.cancel(id);
      setAnnouncements((previous) =>
        previous.map((item) => (item.id === id ? cancelled : item)),
      );
      toast.success("Announcement cancelled.");
    } catch (error) {
      toast.error(
        error instanceof ApiError
          ? error.message
          : "Failed to cancel the announcement.",
      );
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>New announcement</CardTitle>
          <CardDescription>
            Goes to every user who has not turned announcements off. There is no
            audience targeting, and it cannot be recalled once it starts going
            out — cancelling stops further delivery but leaves notifications
            already sent in place.
          </CardDescription>
        </CardHeader>

        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="space-y-2">
              <Label htmlFor="announcement-title">Title</Label>
              <Input
                id="announcement-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                required
                minLength={3}
                maxLength={120}
                placeholder="Competition preferences are here"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="announcement-body">Message</Label>
              <Textarea
                id="announcement-body"
                value={body}
                onChange={(event) => setBody(event.target.value)}
                required
                minLength={3}
                maxLength={500}
                rows={3}
                placeholder="Tell Kizunia what you are interested in and we will find competitions that match."
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="announcement-url">Link (optional)</Label>
              <Input
                id="announcement-url"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="/user/competition-preferences"
              />
              <p className="text-xs text-muted-foreground">
                A path inside Kizunia, or an https:// address. Anything else is
                rejected.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="announcement-when">Send at (optional)</Label>
              <Input
                id="announcement-when"
                type="datetime-local"
                value={scheduledFor}
                onChange={(event) => setScheduledFor(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Leave empty to send on the next scheduled run.
              </p>
            </div>

            <Button type="submit" disabled={submitting} className="self-start">
              {submitting ? "Scheduling…" : "Schedule announcement"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent announcements</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : announcements.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>No announcements yet</EmptyTitle>
                <EmptyDescription>
                  Anything you schedule will be listed here with its status.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <ul className="flex flex-col gap-2">
              {announcements.map((announcement) => (
                <li
                  key={announcement.id}
                  className="flex items-start justify-between gap-4 rounded-lg border px-4 py-3"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-medium">
                        {announcement.title}
                      </p>
                      <Badge variant={statusVariant(announcement.status)}>
                        {announcement.status.toLowerCase()}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {announcement.body}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {announcement.publishedAt
                        ? `Sent ${new Date(announcement.publishedAt).toLocaleString()}`
                        : `Scheduled for ${new Date(announcement.scheduledFor).toLocaleString()}`}
                    </p>
                  </div>

                  {CANCELLABLE.has(announcement.status) ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void handleCancel(announcement.id)}
                    >
                      Cancel
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
