"use client";

import { useState } from "react";

import { authClient } from "@/lib/auth-client";
import { usePortfolioStore } from "../store/portfolio.store";

/**
 * Centralizes the Portfolio-required creation sequence used by every
 * feature that needs a Portfolio to exist first:
 *
 *   requestCreate()
 *     username exists -> create portfolio -> done
 *     no username      -> open UsernameDialog -> user sets username ->
 *                          onUsernameSet() -> create portfolio -> done
 *
 * Callers render their own `<UsernameDialog>` wired to the returned state
 * (see PortfolioRequired and /portfolio/page.tsx) rather than this hook
 * owning the dialog itself, since the two call sites need different
 * copy/placement around it.
 */
export function usePortfolioCreationFlow() {
  const session = authClient.useSession();

  const [usernameDialogOpen, setUsernameDialogOpen] = useState(false);

  const createPortfolio = usePortfolioStore((state) => state.createPortfolio);
  const isCreating = usePortfolioStore((state) => state.isCreating);

  const requestCreate = () => {
    if (session.data?.user.username) {
      void createPortfolio();
      return;
    }

    setUsernameDialogOpen(true);
  };

  const onUsernameSet = () => {
    void createPortfolio();
  };

  return {
    usernameDialogOpen,
    setUsernameDialogOpen,
    requestCreate,
    onUsernameSet,
    isCreating,
  };
}
