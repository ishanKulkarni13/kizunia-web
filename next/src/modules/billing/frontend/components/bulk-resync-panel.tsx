"use client";

import { useState } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { BillingAdminApi } from "../../api/billing-admin-api";
import type { BulkResyncResultDTO } from "../../backend/admin/admin-billing.dto";
import { errorMessage } from "./billing-admin-format";

/**
 * Bulk re-sync (SUPER_ADMIN). It only marks subscriptions due; the background
 * `billing:sync` job then fetches them within the provider request budget, so a
 * large re-sync drains over several runs and never mutates anything at
 * Razorpay. Preview first (a dry run counts the matches and writes nothing),
 * then confirm. Shown only when the server says the viewer may manage billing.
 */
export function BulkResyncPanel({ onDone }: { onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [since, setSince] = useState("");
  const [preview, setPreview] = useState<BulkResyncResultDTO | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const body = () => ({
    reason: reason.trim(),
    ...(since !== "" && { lastSyncedBefore: new Date(since).toISOString() }),
  });

  function changed(update: () => void) {
    update();
    setPreview(null);
  }

  async function handlePreview(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);

    try {
      setPreview(await BillingAdminApi.bulkResync({ ...body(), dryRun: true }));
    } catch (error) {
      toast.error(errorMessage(error, "Could not preview the re-sync."));
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirm() {
    setBusy(true);

    try {
      const result = await BillingAdminApi.bulkResync(body());
      toast.success(`Marked ${result.marked} subscription(s) due. They sync in the background.`);
      setPreview(null);
      setReason("");
      setSince("");
      onDone();
    } catch (error) {
      toast.error(errorMessage(error, "Could not mark the subscriptions due."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Bulk re-sync</CardTitle>
        <CardDescription>
          Mark subscriptions due for a fresh look at Razorpay, for example after a webhook outage. This only marks them: the
          background job fetches them within the request budget. Nothing is changed at Razorpay.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handlePreview} className="grid gap-3 md:grid-cols-[1fr_16rem_auto] md:items-end">
          <div className="space-y-1">
            <Label htmlFor="resync-reason">Reason</Label>
            <Input
              id="resync-reason"
              required
              minLength={3}
              maxLength={500}
              value={reason}
              onChange={(event) => changed(() => setReason(event.target.value))}
              placeholder="e.g. webhook outage 2 Oct, 09:00–13:00"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="resync-since">Last synced before (optional)</Label>
            <Input id="resync-since" type="datetime-local" value={since} onChange={(event) => changed(() => setSince(event.target.value))} />
          </div>
          <Button type="submit" variant="outline" disabled={busy || reason.trim().length < 3}>
            Preview
          </Button>
        </form>

        {preview && (
          <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
            <span>
              <strong>{preview.matched}</strong> subscription(s) in {preview.mode} match.
            </span>
            <Button size="sm" disabled={busy || preview.matched === 0} onClick={() => setConfirmOpen(true)}>
              Mark {preview.matched} due…
            </Button>
          </div>
        )}
      </CardContent>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mark {preview?.matched ?? 0} subscriptions due?</AlertDialogTitle>
            <AlertDialogDescription>
              They will be synced by the background job, within the provider request budget. This is recorded with your name and
              the reason.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleConfirm()}>Mark due</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
