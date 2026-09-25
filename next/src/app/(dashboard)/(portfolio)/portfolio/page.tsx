"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { PortfolioVisibility } from "@/generated/prisma";
import { Capability, minimumPlanFor, PLAN_DISPLAY_NAME } from "@/lib/entitlements/catalog";
import type { MyEntitlementsDTO } from "@/modules/billing";
import { EntitlementsApi } from "@/modules/billing/api/entitlements-api";
import { PortfolioDeletedState } from "@/modules/portfolio/frontend/components/portfolio-deleted-state";
import { PortfolioEmptyState } from "@/modules/portfolio/frontend/components/portfolio-empty-state";
import { PortfolioEditorLoading } from "@/modules/portfolio/frontend/components/editor/portfolio-editor-loading";
import { usePortfolioStore } from "@/modules/portfolio/frontend/store/portfolio.store";
import { UsernameDialog } from "@/modules/portfolio/frontend/components/username-dialog";
import { usePortfolioCreationFlow } from "@/modules/portfolio/frontend/hooks/use-portfolio-creation-flow";

export default function PortfolioPage() {
  const portfolio = usePortfolioStore((state) => state.portfolio);
  const isLoading = usePortfolioStore((state) => state.isLoading);
  const isDeleted = usePortfolioStore((state) => state.isDeleted);
  const isMutating = usePortfolioStore((state) => state.isMutating);
  const restorePortfolio = usePortfolioStore((state) => state.restorePortfolio);
  const getMine = usePortfolioStore((state) => state.getMine);
  const createError = usePortfolioStore((state) => state.error);

  // Server-computed flags; only used for explanatory copy. Enforcement is the
  // server's (PortfolioPolicy), which also lets platform admins through.
  const [entitlements, setEntitlements] = useState<MyEntitlementsDTO | null>(null);

  useEffect(() => {
    EntitlementsApi.getMine()
      .then(setEntitlements)
      .catch(() => {
        // Copy only — nothing to recover.
      });
  }, []);

  const lacksPortfolio = entitlements !== null && !entitlements.capabilities.portfolio;
  const requiredPlan = PLAN_DISPLAY_NAME[minimumPlanFor(Capability.PORTFOLIO)];

  const {
    usernameDialogOpen,
    setUsernameDialogOpen,
    requestCreate,
    onUsernameSet,
    isCreating,
  } = usePortfolioCreationFlow();

  useEffect(() => {
    void getMine();
  }, [getMine]);

  if (isLoading) {
    return <PortfolioEditorLoading />;
  }

  return (
    <>
      {isDeleted ? (
        <PortfolioDeletedState
          isRestoring={isMutating}
          onRestore={() => void restorePortfolio()}
        />
      ) : !portfolio ? (
        <PortfolioEmptyState
          isCreating={isCreating}
          onCreate={requestCreate}
          error={createError}
          upgradeHint={lacksPortfolio ? `Portfolios require ${requiredPlan}.` : null}
        />
      ) : (
        <div className="flex min-h-[60vh] items-center justify-center px-6">
          <div className="w-full max-w-xl rounded-2xl border bg-card p-10 text-center shadow-sm">
            <p className="text-sm text-muted-foreground">Portfolio</p>

            <h1 className="mt-1 text-2xl font-semibold tracking-tight">
              {portfolio.displayName}
            </h1>

            <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-muted-foreground">
              {portfolio.user.username
                ? `kizunia.com/u/${portfolio.user.username}`
                : "Not publicly reachable yet — set a username in the editor."}
            </p>

            {lacksPortfolio && portfolio.visibility === PortfolioVisibility.PUBLIC && (
              <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-muted-foreground">
                Your portfolio is hidden from the public while your plan does not include
                portfolios. Upgrade to {requiredPlan} to show it again — nothing has been
                deleted, and you can keep editing it.
              </p>
            )}

            <Button asChild className="mt-7">
              <Link href="/portfolio/edit">Open Editor</Link>
            </Button>
          </div>
        </div>
      )}

      <UsernameDialog
        open={usernameDialogOpen}
        onOpenChange={setUsernameDialogOpen}
        title="Set your username"
        description="Your portfolio's public URL is based on your username. Choose one to continue creating your portfolio."
        submitLabel="Continue"
        onSuccess={onUsernameSet}
      />
    </>
  );
}
