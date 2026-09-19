"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { PortfolioEditorHeader } from "./portfolio-editor-header";
import { PortfolioEditorNavigation } from "./portfolio-editor-navigation";

import { usePortfolioStore } from "../../store/portfolio.store";

interface PortfolioEditorLayoutProps {
  children: React.ReactNode;
}

export function PortfolioEditorLayout({
  children,
}: PortfolioEditorLayoutProps) {
  const router = useRouter();

  const portfolio = usePortfolioStore((state) => state.portfolio);
  const isLoading = usePortfolioStore((state) => state.isLoading);
  const error = usePortfolioStore((state) => state.error);
  const getMine = usePortfolioStore((state) => state.getMine);

  useEffect(() => {
    if (!portfolio) {
      void getMine();
    }
    // Only fetch once on mount if nothing is loaded yet — section
    // navigation within the editor must not re-trigger a fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // The editor never creates a portfolio itself — creation only happens
    // through /portfolio's PortfolioRequired-style flow. If someone lands
    // here directly with no portfolio (or it was deleted), send them back.
    if (!isLoading && !error && !portfolio) {
      router.replace("/portfolio");
    }
  }, [isLoading, error, portfolio, router]);

  if (isLoading || (!portfolio && !error)) {
    return (
      <div className="flex min-h-full flex-col">
        <div className="space-y-6">
          <div className="h-8 w-64 animate-pulse rounded-md bg-muted" />
          <div className="h-10 w-full animate-pulse rounded-md bg-muted" />
          <div className="h-64 w-full animate-pulse rounded-md bg-muted" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <div className="max-w-md space-y-2 text-center">
          <h2 className="text-lg font-semibold">Unable to load portfolio</h2>

          <p className="text-sm text-muted-foreground">{error}</p>
        </div>
      </div>
    );
  }

  if (!portfolio) {
    return null;
  }

  return (
    <div className="flex min-h-full w-full flex-col md:mx-auto md:w-fit md:min-w-2xl">
      <div className="space-y-4">
        <PortfolioEditorHeader portfolio={portfolio} />

        <PortfolioEditorNavigation />

        <main>{children}</main>
      </div>
    </div>
  );
}
