"use client";

import { Plus } from "lucide-react";

interface PortfolioEmptyStateProps {
  isCreating: boolean;
  onCreate: () => void;
}

export function PortfolioEmptyState({
  isCreating,
  onCreate,
}: PortfolioEmptyStateProps) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-6">
      <div className="w-full max-w-xl rounded-2xl border bg-card p-10 text-center shadow-sm">
        <div className="mx-auto mb-6 flex size-14 items-center justify-center rounded-full bg-muted">
          <Plus className="size-6" />
        </div>

        <h1 className="text-2xl font-semibold tracking-tight">
          Create your portfolio
        </h1>

        <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-muted-foreground">
          Showcase your projects, experience, skills, achievements,
          and everything you have built on Kizunia.
        </p>

        <button
          type="button"
          onClick={onCreate}
          disabled={isCreating}
          className="mt-7 inline-flex items-center justify-center rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isCreating ? "Creating..." : "Create Portfolio"}
        </button>
      </div>
    </div>
  );
}