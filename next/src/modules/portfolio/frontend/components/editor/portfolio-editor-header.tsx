"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { PortfolioEditorDto } from "@/modules/portfolio/dtos";
import { UsernameDialog } from "@/modules/portfolio/frontend/components/username-dialog";
import { usePortfolioStore } from "@/modules/portfolio/frontend/store/portfolio.store";

interface PortfolioEditorHeaderProps {
  portfolio: PortfolioEditorDto;
}

export function PortfolioEditorHeader({
  portfolio,
}: PortfolioEditorHeaderProps) {
  const [usernameDialogOpen, setUsernameDialogOpen] = useState(false);

  const setPortfolio = usePortfolioStore((state) => state.setPortfolio);

  return (
    <header className="flex items-start justify-between gap-4">
      <div className="space-y-1">
        <p className="text-sm text-muted-foreground">Portfolio editor</p>

        <h1 className="text-2xl font-semibold tracking-tight">
          {portfolio.displayName}
        </h1>

        <p className="text-sm text-muted-foreground">
          {portfolio.user.username
            ? `kizunia.com/u/${portfolio.user.username}`
            : "Set a username to make your portfolio publicly reachable."}
        </p>
      </div>

      <Button
        type="button"
        variant="outline"
        onClick={() => setUsernameDialogOpen(true)}
      >
        Change Username
      </Button>

      <UsernameDialog
        open={usernameDialogOpen}
        onOpenChange={setUsernameDialogOpen}
        title="Change username"
        description="This changes your public portfolio URL. Links to your old username will stop working."
        submitLabel="Save"
        initialUsername={portfolio.user.username ?? ""}
        onSuccess={(username) => {
          setPortfolio({
            ...portfolio,
            user: {
              ...portfolio.user,
              username,
            },
          });
        }}
      />
    </header>
  );
}
