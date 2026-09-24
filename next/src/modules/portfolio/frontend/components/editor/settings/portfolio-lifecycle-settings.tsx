"use client";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

import { usePortfolioStore } from "../../../store/portfolio.store";

/**
 * Who can see the portfolio, and the way to take it down. Both are enforced
 * by the server (PortfolioAuthorizer); this only exposes them.
 */
export function PortfolioLifecycleSettings() {
  const portfolio = usePortfolioStore((state) => state.portfolio);
  const isMutating = usePortfolioStore((state) => state.isMutating);
  const setVisibility = usePortfolioStore((state) => state.setVisibility);
  const deletePortfolio = usePortfolioStore((state) => state.deletePortfolio);

  if (!portfolio) {
    return null;
  }

  const isPublic = portfolio.visibility === "PUBLIC";

  return (
    <div className="w-full max-w-3xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>

        <p className="mt-1 text-sm text-muted-foreground">
          Control who can see your portfolio.
        </p>
      </div>

      <div className="flex items-start justify-between gap-6 rounded-xl border p-5">
        <div className="space-y-1">
          <Label htmlFor="portfolio-visibility" className="text-base">
            {isPublic ? "Public" : "Private"}
          </Label>

          <p className="text-sm text-muted-foreground">
            {isPublic
              ? "Anyone with your link can view your portfolio, including the contact details you added."
              : "Only you can see your portfolio. Turn this on to publish it."}
          </p>
        </div>

        <Switch
          id="portfolio-visibility"
          checked={isPublic}
          disabled={isMutating}
          onCheckedChange={(checked) =>
            void setVisibility(checked ? "PUBLIC" : "PRIVATE")
          }
        />
      </div>

      <div className="flex items-start justify-between gap-6 rounded-xl border border-destructive/30 p-5">
        <div className="space-y-1">
          <p className="text-base font-medium">Delete portfolio</p>

          <p className="text-sm text-muted-foreground">
            Your portfolio stops being visible to everyone immediately. Nothing
            is erased, and you can restore it later.
          </p>
        </div>

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button type="button" variant="destructive" disabled={isMutating}>
              Delete
            </Button>
          </AlertDialogTrigger>

          <AlertDialogContent className="sm:max-w-md">
            <AlertDialogHeader>
              <AlertDialogTitle>Delete your portfolio?</AlertDialogTitle>

              <AlertDialogDescription>
                It will no longer be visible to anyone. Your profile, projects,
                testimonials and technologies are kept, and you can restore the
                portfolio at any time — it will come back private.
              </AlertDialogDescription>
            </AlertDialogHeader>

            <AlertDialogFooter>
              <AlertDialogCancel disabled={isMutating}>Cancel</AlertDialogCancel>

              <AlertDialogAction
                variant="destructive"
                disabled={isMutating}
                onClick={() => void deletePortfolio()}
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}
