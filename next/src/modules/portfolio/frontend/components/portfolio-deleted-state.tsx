"use client";

import { Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";

interface PortfolioDeletedStateProps {
  isRestoring: boolean;

  onRestore: () => void;
}

/**
 * Shown when the user's portfolio exists but is soft-deleted. Creating a new
 * one is refused while it does, so restoring is the only way forward.
 */
export function PortfolioDeletedState({
  isRestoring,
  onRestore,
}: PortfolioDeletedStateProps) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-6">
      <div className="w-full max-w-xl rounded-2xl border bg-card p-10 text-center shadow-sm">
        <div className="mx-auto mb-6 flex size-14 items-center justify-center rounded-full bg-muted">
          <Trash2 className="size-6" />
        </div>

        <h1 className="text-2xl font-semibold tracking-tight">
          Your portfolio was deleted
        </h1>

        <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-muted-foreground">
          It is no longer visible to anyone, but nothing was lost. Restore it to
          pick up where you left off — it will come back private, so you decide
          when to publish it again.
        </p>

        <Button
          type="button"
          className="mt-7"
          onClick={onRestore}
          disabled={isRestoring}
        >
          {isRestoring ? "Restoring..." : "Restore portfolio"}
        </Button>
      </div>
    </div>
  );
}
