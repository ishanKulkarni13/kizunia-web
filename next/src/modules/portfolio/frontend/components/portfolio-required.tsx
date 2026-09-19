"use client";

import { useEffect } from "react";

import { usePortfolioStore } from "../store/portfolio.store";
import { usePortfolioCreationFlow } from "../hooks/use-portfolio-creation-flow";
import { UsernameDialog } from "./username-dialog";

interface PortfolioRequiredProps {
  children: React.ReactNode;
}

/**
 * Gates a feature behind the existence of the current user's Portfolio.
 * Opt-in — wrap only the features that actually need a Portfolio, do not
 * use this as global route middleware.
 *
 * No Portfolio -> shows a Create Portfolio prompt (handling the
 * missing-username sub-flow via UsernameDialog) -> once created, renders
 * `children`.
 */
export function PortfolioRequired({ children }: PortfolioRequiredProps) {
  const portfolio = usePortfolioStore((state) => state.portfolio);
  const isLoading = usePortfolioStore((state) => state.isLoading);
  const getMine = usePortfolioStore((state) => state.getMine);

  const {
    usernameDialogOpen,
    setUsernameDialogOpen,
    requestCreate,
    onUsernameSet,
    isCreating,
  } = usePortfolioCreationFlow();

  useEffect(() => {
    if (!portfolio) {
      void getMine();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (isLoading) {
    return (
      <div className="flex min-h-[200px] items-center justify-center">
        <div className="h-8 w-48 animate-pulse rounded-md bg-muted" />
      </div>
    );
  }

  if (portfolio) {
    return <>{children}</>;
  }

  return (
    <div className="flex min-h-[200px] flex-col items-center justify-center gap-3 rounded-xl border bg-card p-8 text-center">
      <p className="text-sm font-medium">This feature requires a portfolio.</p>

      <p className="max-w-sm text-sm text-muted-foreground">
        Create your portfolio to continue.
      </p>

      <button
        type="button"
        onClick={requestCreate}
        disabled={isCreating}
        className="mt-2 inline-flex items-center justify-center rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isCreating ? "Creating..." : "Create Portfolio"}
      </button>

      <UsernameDialog
        open={usernameDialogOpen}
        onOpenChange={setUsernameDialogOpen}
        title="Set your username"
        description="Your portfolio's public URL is based on your username. Choose one to continue creating your portfolio."
        submitLabel="Continue"
        onSuccess={onUsernameSet}
      />
    </div>
  );
}
