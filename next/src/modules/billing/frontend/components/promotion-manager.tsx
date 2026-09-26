"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ApiError } from "@/lib/http";

import { PromotionApi } from "../../api/promotion-api";
import type { GrantPlanDTO } from "../../backend/grants/grant.dto";
import type { PromotionDTO, PromotionEligibilityDTO, PromotionListDTO } from "../../backend/grants/promotion.dto";

const PLAN_LABEL: Record<GrantPlanDTO, string> = { PRO: "Pro", PRO_PLUS: "Pro+" };

const ELIGIBILITY_LABEL: Record<PromotionEligibilityDTO, string> = {
  ANY_USER: "Anyone",
  FIRST_PAID_SUBSCRIPTION_ONLY: "No paid subscription yet",
  ONCE_PER_USER: "Once per user",
};

function stateVariant(state: PromotionDTO["state"]) {
  if (state === "ACTIVE") return "default" as const;
  if (state === "SOLD_OUT") return "destructive" as const;

  return "secondary" as const;
}

function formatDate(iso: string | null, empty: string): string {
  return iso === null ? empty : new Date(iso).toLocaleString();
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

/**
 * Admin promotions: list and create. A promotion is free plan access redeemed
 * with a code (it never involves a payment provider).
 *
 * Every rule is the server's: who may manage them (`MANAGE_ENTITLEMENT_GRANTS`,
 * enforced by the API, so a refused request shows the server's message), what a
 * valid window is, and each promotion's derived `state`. This component only
 * renders those answers.
 */
export function PromotionManager() {
  const [data, setData] = useState<PromotionListDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await PromotionApi.list({ page }));
    } catch (error) {
      toast.error(errorMessage(error, "Failed to load promotions."));
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button onClick={() => setCreateOpen(true)}>Create promotion</Button>
      </div>

      {loading && !data ? (
        <Skeleton className="h-48 w-full" />
      ) : data && data.items.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No promotions</EmptyTitle>
            <EmptyDescription>Create one to give free access with a code.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Code</TableHead>
              <TableHead>Plan</TableHead>
              <TableHead>Duration</TableHead>
              <TableHead>State</TableHead>
              <TableHead>Redeemed</TableHead>
              <TableHead>Remaining</TableHead>
              <TableHead>Eligibility</TableHead>
              <TableHead>Valid from</TableHead>
              <TableHead>Valid until</TableHead>
              <TableHead>Created by</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data?.items.map((promotion) => (
              <TableRow key={promotion.id}>
                <TableCell className="font-mono">{promotion.code}</TableCell>
                <TableCell>{PLAN_LABEL[promotion.plan]}</TableCell>
                <TableCell>{promotion.durationDays} days</TableCell>
                <TableCell>
                  <Badge variant={stateVariant(promotion.state)}>{promotion.state.replace("_", " ").toLowerCase()}</Badge>
                </TableCell>
                <TableCell>{promotion.redemptionCount}</TableCell>
                <TableCell>{promotion.remainingRedemptions ?? "Unlimited"}</TableCell>
                <TableCell>{ELIGIBILITY_LABEL[promotion.eligibility]}</TableCell>
                <TableCell className="whitespace-nowrap">{formatDate(promotion.validFrom, "—")}</TableCell>
                <TableCell className="whitespace-nowrap">{formatDate(promotion.validUntil, "Never")}</TableCell>
                <TableCell>{promotion.createdBy.name ?? promotion.createdBy.id}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {data && data.pagination.totalPages > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <Button size="sm" variant="outline" disabled={!data.pagination.hasPreviousPage || loading} onClick={() => setPage((current) => current - 1)}>
            Previous
          </Button>
          <span>
            Page {data.pagination.page} of {data.pagination.totalPages}
          </span>
          <Button size="sm" variant="outline" disabled={!data.pagination.hasNextPage || loading} onClick={() => setPage((current) => current + 1)}>
            Next
          </Button>
        </div>
      )}

      <CreatePromotionDialog open={createOpen} onOpenChange={setCreateOpen} onSaved={load} />
    </div>
  );
}

function CreatePromotionDialog({
  open,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => Promise<void>;
}) {
  const [code, setCode] = useState("");
  const [plan, setPlan] = useState<GrantPlanDTO>("PRO");
  const [durationDays, setDurationDays] = useState("30");
  const [maxRedemptions, setMaxRedemptions] = useState("100");
  const [unlimited, setUnlimited] = useState(false);
  const [validFrom, setValidFrom] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [eligibility, setEligibility] = useState<PromotionEligibilityDTO>("ANY_USER");
  const [saving, setSaving] = useState(false);

  function reset() {
    setCode("");
    setPlan("PRO");
    setDurationDays("30");
    setMaxRedemptions("100");
    setUnlimited(false);
    setValidFrom("");
    setValidUntil("");
    setEligibility("ANY_USER");
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);

    try {
      await PromotionApi.create({
        code: code.trim(),
        plan,
        durationDays: Number(durationDays),
        maxRedemptions: unlimited ? null : Number(maxRedemptions),
        ...(validFrom !== "" && { validFrom: new Date(validFrom).toISOString() }),
        validUntil: validUntil === "" ? null : new Date(validUntil).toISOString(),
        eligibility,
      });
      toast.success("Promotion created.");
      reset();
      onOpenChange(false);
      await onSaved();
    } catch (error) {
      toast.error(errorMessage(error, "Could not create the promotion."));
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
            <DialogTitle>Create promotion</DialogTitle>
            <DialogDescription>
              Free plan access for a period, redeemed once per user with a code. A code can&apos;t also be a discount code.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1">
            <Label htmlFor="promotion-new-code">Code</Label>
            <Input id="promotion-new-code" required maxLength={64} value={code} onChange={(event) => setCode(event.target.value)} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="promotion-new-plan">Plan</Label>
              <NativeSelect id="promotion-new-plan" value={plan} onChange={(event) => setPlan(event.target.value as GrantPlanDTO)}>
                <NativeSelectOption value="PRO">Pro</NativeSelectOption>
                <NativeSelectOption value="PRO_PLUS">Pro+</NativeSelectOption>
              </NativeSelect>
            </div>
            <div className="space-y-1">
              <Label htmlFor="promotion-new-duration">Access (days)</Label>
              <Input
                id="promotion-new-duration"
                type="number"
                min={1}
                max={3650}
                required
                value={durationDays}
                onChange={(event) => setDurationDays(event.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="promotion-new-max">Redemption limit</Label>
            <div className="flex items-center gap-3">
              <Input
                id="promotion-new-max"
                type="number"
                min={1}
                required={!unlimited}
                disabled={unlimited}
                value={maxRedemptions}
                onChange={(event) => setMaxRedemptions(event.target.value)}
                className="w-32"
              />
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={unlimited} onChange={(event) => setUnlimited(event.target.checked)} />
                No limit
              </label>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="promotion-new-from">Valid from (optional)</Label>
              <Input id="promotion-new-from" type="datetime-local" value={validFrom} onChange={(event) => setValidFrom(event.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="promotion-new-until">Valid until (optional)</Label>
              <Input id="promotion-new-until" type="datetime-local" value={validUntil} onChange={(event) => setValidUntil(event.target.value)} />
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="promotion-new-eligibility">Who can redeem it</Label>
            <NativeSelect
              id="promotion-new-eligibility"
              value={eligibility}
              onChange={(event) => setEligibility(event.target.value as PromotionEligibilityDTO)}
            >
              {(Object.keys(ELIGIBILITY_LABEL) as PromotionEligibilityDTO[]).map((rule) => (
                <NativeSelectOption key={rule} value={rule}>
                  {ELIGIBILITY_LABEL[rule]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={saving}>
              {saving ? "Creating…" : "Create promotion"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
