"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { ApiError } from "@/lib/http";

import { GrantApi } from "../../api/grant-api";
import type { GrantDTO, GrantListDTO, GrantPlanDTO } from "../../backend/grants/grant.dto";

const PLAN_LABEL: Record<GrantPlanDTO, string> = { PRO: "Pro", PRO_PLUS: "Pro+" };

function stateVariant(state: GrantDTO["state"]) {
  if (state === "ACTIVE") return "default" as const;
  if (state === "REVOKED") return "destructive" as const;
  return "secondary" as const;
}

function formatDate(iso: string | null): string {
  return iso === null ? "No expiry" : new Date(iso).toLocaleString();
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

/** `datetime-local` value (local time, minute precision) for an ISO instant. */
function toLocalInput(iso: string): string {
  const date = new Date(iso);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

/**
 * Admin entitlement grants: list, create, extend, revoke.
 *
 * Every rule (who may manage, what a valid extension is, whether a grant is
 * active) is decided by the server. This component only renders the server's
 * answers — `permissions.canManage` and each grant's derived `state` — and
 * shows the server's error messages.
 */
export function GrantManager() {
  const [data, setData] = useState<GrantListDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [emailFilter, setEmailFilter] = useState("");
  const [appliedEmail, setAppliedEmail] = useState("");
  const [page, setPage] = useState(1);

  const [createOpen, setCreateOpen] = useState(false);
  const [extending, setExtending] = useState<GrantDTO | null>(null);
  const [revoking, setRevoking] = useState<GrantDTO | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await GrantApi.list({ email: appliedEmail || undefined, page }));
    } catch (error) {
      toast.error(errorMessage(error, "Failed to load grants."));
    } finally {
      setLoading(false);
    }
  }, [appliedEmail, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const canManage = data?.permissions.canManage ?? false;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-2">
        <form
          className="flex items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            setPage(1);
            setAppliedEmail(emailFilter.trim().toLowerCase());
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="grant-email-filter">Recipient e-mail</Label>
            <Input
              id="grant-email-filter"
              type="email"
              placeholder="user@example.com"
              value={emailFilter}
              onChange={(event) => setEmailFilter(event.target.value)}
              className="w-72"
            />
          </div>
          <Button type="submit" variant="outline">
            Filter
          </Button>
        </form>

        {canManage && (
          <Button className="ml-auto" onClick={() => setCreateOpen(true)}>
            Grant access
          </Button>
        )}
      </div>

      {loading && !data ? (
        <Skeleton className="h-48 w-full" />
      ) : data && data.items.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No grants</EmptyTitle>
            <EmptyDescription>
              {appliedEmail ? "No grants match that recipient." : "No entitlement grants exist yet."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Recipient</TableHead>
              <TableHead>Plan</TableHead>
              <TableHead>State</TableHead>
              <TableHead>Valid from</TableHead>
              <TableHead>Valid until</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead>Granted by</TableHead>
              {canManage && <TableHead className="text-right">Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {data?.items.map((grant) => (
              <TableRow key={grant.id}>
                <TableCell>
                  {grant.recipient ? (
                    <div className="flex flex-col">
                      <span className="font-medium">{grant.recipient.name}</span>
                      <span className="text-xs text-muted-foreground">{grant.recipient.email}</span>
                    </div>
                  ) : (
                    <span className="text-muted-foreground">Removed account</span>
                  )}
                </TableCell>
                <TableCell>{PLAN_LABEL[grant.plan]}</TableCell>
                <TableCell>
                  <Badge variant={stateVariant(grant.state)}>{grant.state.toLowerCase()}</Badge>
                </TableCell>
                <TableCell className="whitespace-nowrap">{formatDate(grant.validFrom)}</TableCell>
                <TableCell className="whitespace-nowrap">{formatDate(grant.validUntil)}</TableCell>
                <TableCell className="max-w-64 truncate" title={grant.reason}>
                  {grant.reason}
                </TableCell>
                <TableCell>{grant.grantedBy?.name ?? grant.grantedBy?.id ?? "—"}</TableCell>
                {canManage && (
                  <TableCell className="text-right">
                    {grant.status === "ACTIVE" && (
                      <div className="flex justify-end gap-2">
                        {grant.validUntil !== null && (
                          <Button size="sm" variant="outline" onClick={() => setExtending(grant)}>
                            Extend
                          </Button>
                        )}
                        <Button size="sm" variant="destructive" onClick={() => setRevoking(grant)}>
                          Revoke
                        </Button>
                      </div>
                    )}
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {data && data.pagination.totalPages > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <Button
            size="sm"
            variant="outline"
            disabled={!data.pagination.hasPreviousPage || loading}
            onClick={() => setPage((current) => current - 1)}
          >
            Previous
          </Button>
          <span>
            Page {data.pagination.page} of {data.pagination.totalPages}
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={!data.pagination.hasNextPage || loading}
            onClick={() => setPage((current) => current + 1)}
          >
            Next
          </Button>
        </div>
      )}

      <CreateGrantDialog open={createOpen} onOpenChange={setCreateOpen} onSaved={load} />
      <ExtendGrantDialog grant={extending} onClose={() => setExtending(null)} onSaved={load} />
      <RevokeGrantDialog grant={revoking} onClose={() => setRevoking(null)} onSaved={load} />
    </div>
  );
}

function CreateGrantDialog({
  open,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => Promise<void>;
}) {
  const [recipient, setRecipient] = useState("");
  const [plan, setPlan] = useState<GrantPlanDTO>("PRO");
  const [durationDays, setDurationDays] = useState("30");
  const [noExpiry, setNoExpiry] = useState(false);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  function reset() {
    setRecipient("");
    setPlan("PRO");
    setDurationDays("30");
    setNoExpiry(false);
    setReason("");
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);

    const target = recipient.trim();
    const common = {
      plan,
      durationDays: noExpiry ? null : Number(durationDays),
      reason: reason.trim(),
    };

    try {
      await GrantApi.create(target.includes("@") ? { email: target, ...common } : { userId: target, ...common });
      toast.success("Access granted.");
      reset();
      onOpenChange(false);
      await onSaved();
    } catch (error) {
      toast.error(errorMessage(error, "Could not create the grant."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) reset();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Grant access</DialogTitle>
            <DialogDescription>
              Give a user plan access without payment. You cannot grant access to yourself.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1">
            <Label htmlFor="grant-recipient">Recipient (e-mail or user ID)</Label>
            <Input
              id="grant-recipient"
              required
              value={recipient}
              onChange={(event) => setRecipient(event.target.value)}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="grant-plan">Plan</Label>
            <NativeSelect
              id="grant-plan"
              value={plan}
              onChange={(event) => setPlan(event.target.value as GrantPlanDTO)}
            >
              <NativeSelectOption value="PRO">Pro</NativeSelectOption>
              <NativeSelectOption value="PRO_PLUS">Pro+</NativeSelectOption>
            </NativeSelect>
          </div>

          <div className="space-y-1">
            <Label htmlFor="grant-duration">Duration (days)</Label>
            <div className="flex items-center gap-3">
              <Input
                id="grant-duration"
                type="number"
                min={1}
                max={3650}
                required={!noExpiry}
                disabled={noExpiry}
                value={durationDays}
                onChange={(event) => setDurationDays(event.target.value)}
                className="w-32"
              />
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={noExpiry}
                  onChange={(event) => setNoExpiry(event.target.checked)}
                />
                No expiry
              </label>
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="grant-reason">Reason</Label>
            <Textarea
              id="grant-reason"
              required
              minLength={3}
              maxLength={500}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </div>

          <DialogFooter>
            <Button type="submit" disabled={saving}>
              {saving ? "Granting…" : "Grant access"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ExtendGrantDialog({
  grant,
  onClose,
  onSaved,
}: {
  grant: GrantDTO | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [validUntil, setValidUntil] = useState("");
  const [noExpiry, setNoExpiry] = useState(false);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (grant?.validUntil) setValidUntil(toLocalInput(grant.validUntil));
    setNoExpiry(false);
    setReason("");
  }, [grant]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!grant) return;
    setSaving(true);

    try {
      await GrantApi.extend(grant.id, {
        validUntil: noExpiry ? null : new Date(validUntil).toISOString(),
        reason: reason.trim(),
      });
      toast.success("Grant extended.");
      onClose();
      await onSaved();
    } catch (error) {
      toast.error(errorMessage(error, "Could not extend the grant."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={grant !== null} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Extend grant</DialogTitle>
            <DialogDescription>
              Currently ends {formatDate(grant?.validUntil ?? null)}. An extension must end later;
              to shorten a grant, revoke it.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1">
            <Label htmlFor="grant-valid-until">New end</Label>
            <Input
              id="grant-valid-until"
              type="datetime-local"
              required={!noExpiry}
              disabled={noExpiry}
              value={validUntil}
              onChange={(event) => setValidUntil(event.target.value)}
            />
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={noExpiry}
                onChange={(event) => setNoExpiry(event.target.checked)}
              />
              No expiry
            </label>
          </div>

          <div className="space-y-1">
            <Label htmlFor="grant-extend-reason">Reason</Label>
            <Textarea
              id="grant-extend-reason"
              required
              minLength={3}
              maxLength={500}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </div>

          <DialogFooter>
            <Button type="submit" disabled={saving}>
              {saving ? "Extending…" : "Extend"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RevokeGrantDialog({
  grant,
  onClose,
  onSaved,
}: {
  grant: GrantDTO | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setReason("");
  }, [grant]);

  async function handleRevoke(event: React.FormEvent) {
    event.preventDefault();
    if (!grant) return;
    setSaving(true);

    try {
      await GrantApi.revoke(grant.id, { reason: reason.trim() });
      toast.success("Grant revoked.");
      onClose();
      await onSaved();
    } catch (error) {
      toast.error(errorMessage(error, "Could not revoke the grant."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <AlertDialog open={grant !== null} onOpenChange={(next) => !next && onClose()}>
      <AlertDialogContent>
        <form onSubmit={handleRevoke} className="flex flex-col gap-4">
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke grant?</AlertDialogTitle>
            <AlertDialogDescription>
              {grant?.recipient?.name ?? "The recipient"} loses this {grant ? PLAN_LABEL[grant.plan] : ""}{" "}
              grant immediately. Revocation is final — it cannot be extended again.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-1">
            <Label htmlFor="grant-revoke-reason">Reason</Label>
            <Textarea
              id="grant-revoke-reason"
              required
              minLength={3}
              maxLength={500}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel type="button">Cancel</AlertDialogCancel>
            <Button type="submit" variant="destructive" disabled={saving}>
              {saving ? "Revoking…" : "Revoke"}
            </Button>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
