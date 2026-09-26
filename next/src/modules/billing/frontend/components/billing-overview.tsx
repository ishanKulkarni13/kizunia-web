"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

import { BillingAdminApi } from "../../api/billing-admin-api";
import type { BillingHealthDTO } from "../../backend/admin/admin-billing.dto";
import { BillingHealthPanel } from "./billing-health-panel";
import { errorMessage, userHref } from "./billing-admin-format";
import { BulkResyncPanel } from "./bulk-resync-panel";

/** Find a user by e-mail address or user id, then open their billing page. */
function UserLookup() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const value = query.trim();
    if (value === "") return;

    setBusy(true);

    try {
      const user = await BillingAdminApi.lookupUser(value.includes("@") ? { email: value } : { userId: value });
      router.push(userHref(user.id));
    } catch (error) {
      toast.error(errorMessage(error, "Could not find that user."));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3">
      <div className="min-w-64 flex-1 space-y-1">
        <Label htmlFor="billing-user-lookup">Look up a user</Label>
        <Input
          id="billing-user-lookup"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="E-mail address or user id"
        />
      </div>
      <Button type="submit" disabled={busy || query.trim() === ""}>
        {busy ? "Looking…" : "Open billing view"}
      </Button>
    </form>
  );
}

/**
 * The billing operations home: look a user up, see whether billing is healthy,
 * and (SUPER_ADMIN, as the server reports) re-sync in bulk.
 */
export function BillingOverview() {
  const [health, setHealth] = useState<BillingHealthDTO | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);

    try {
      setHealth(await BillingAdminApi.health());
    } catch (error) {
      toast.error(errorMessage(error, "Failed to load the billing health summary."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="flex flex-col gap-6">
      <UserLookup />

      {health?.permissions.canManageBilling && <BulkResyncPanel onDone={() => void load()} />}

      {loading && !health ? (
        <Skeleton className="h-96 w-full" />
      ) : health ? (
        <BillingHealthPanel health={health} refreshing={loading} onRefresh={() => void load()} />
      ) : null}
    </div>
  );
}
