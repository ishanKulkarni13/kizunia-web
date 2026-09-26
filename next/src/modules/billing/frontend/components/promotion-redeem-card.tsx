"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoadingButton } from "@/components/ui/loading-button";
import { PLAN_DISPLAY_NAME } from "@/lib/entitlements/catalog";
import { ApiError } from "@/lib/http";

import { BillingApi } from "../../api/billing-api";

/**
 * Redeem a promotion code: free access to a plan for a period.
 *
 * Nothing about the code is decided here. The server looks it up, checks its
 * window, limit and eligibility, and answers with the access now granted or
 * with a reason; this component shows that answer and refreshes the billing
 * summary, which is where the new access appears. It involves no payment and
 * no provider, so it is shown even when paid billing is unavailable.
 */
export function PromotionRedeemCard({ onRedeemed }: { onRedeemed: () => Promise<unknown> | void }) {
  const [code, setCode] = useState("");
  const [redeeming, setRedeeming] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setRedeeming(true);

    try {
      const redeemed = await BillingApi.redeemPromotion(code.trim());

      toast.success(`${PLAN_DISPLAY_NAME[redeemed.plan]} unlocked until ${new Date(redeemed.validUntil).toLocaleDateString()}.`);
      setCode("");
      await onRedeemed();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "We couldn't redeem that code. Please try again.");
    } finally {
      setRedeeming(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Redeem a code</CardTitle>
        <CardDescription>Have a promotion code for free access? Enter it here.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex max-w-md items-end gap-2">
          <div className="flex flex-1 flex-col gap-1">
            <Label htmlFor="promotion-code">Code</Label>
            <Input
              id="promotion-code"
              required
              value={code}
              onChange={(event) => setCode(event.target.value)}
              autoComplete="off"
              maxLength={64}
            />
          </div>
          <LoadingButton type="submit" loading={redeeming} disabled={code.trim() === ""}>
            Redeem
          </LoadingButton>
        </form>
      </CardContent>
    </Card>
  );
}
