"use client";

import Image from "next/image";
import Link from "next/link";
import { ExternalLink, EyeOff, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { StatusBadge } from "@/modules/competitions/components/status-badge";
import { useCompetitionEditorStore } from "@/modules/competitions/store/editor-store";
import { useIsDirty } from "./use-field-status";

/** A pure function of `lastSavedAt` alone (no `Date.now()`), so it never
 * differs between server and client renders and needs no effect to stay
 * in sync — the header re-renders on every store change anyway, which is
 * as often as this needs to update in practice. */
function formatSavedLabel(lastSavedAt: Date | null): string | null {
  if (!lastSavedAt) return null;
  return `Saved at ${lastSavedAt.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  })}`;
}

export function EditorHeader() {
  const competition = useCompetitionEditorStore((s) => s.competition);
  const original = useCompetitionEditorStore((s) => s.original);
  const saving = useCompetitionEditorStore((s) => s.saving);
  const lastSavedAt = useCompetitionEditorStore((s) => s.lastSavedAt);
  const dirty = useIsDirty();
  const save = useCompetitionEditorStore((s) => s.save);
  const reset = useCompetitionEditorStore((s) => s.reset);

  const savedLabel = formatSavedLabel(lastSavedAt);

  if (!competition || !original) return null;

  const isPublic = competition.visibility === "PUBLIC";

  let saveLabel: string;
  if (saving) saveLabel = "Saving...";
  else if (dirty) saveLabel = "Save changes";
  else saveLabel = "Saved";

  const publicPageHref = `/competitions/${original.slug}`;

  return (
    <div className="sticky top-12 z-20 -mx-4 border-b bg-background/95 px-4 py-3 backdrop-blur supports-backdrop-filter:bg-background/80 md:mx-0 md:rounded-t-xl">
      <div className="flex min-w-0 items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="relative size-10 shrink-0 overflow-hidden rounded-md border bg-muted">
            {competition.logoAsset?.secureUrl ? (
              <Image
                src={competition.logoAsset.secureUrl}
                alt=""
                fill
                sizes="40px"
                className="object-cover"
              />
            ) : (
              <div className="flex size-full items-center justify-center text-sm font-semibold text-muted-foreground">
                {competition.title[0]?.toUpperCase() ?? "?"}
              </div>
            )}
          </div>

          <div className="min-w-0">
            <h1
              className="truncate text-lg font-semibold leading-tight"
              title={competition.title}
            >
              {competition.title || "Untitled competition"}
            </h1>

            <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <StatusBadge status={competition.status} className="h-4 px-1.5 text-[10px]" />
              <Badge
                variant="outline"
                className="h-4 px-1.5 text-[10px]"
              >
                {competition.visibility}
              </Badge>
              {savedLabel && !dirty && <span>{savedLabel}</span>}
              {dirty && <span>Unsaved changes</span>}
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="sm" asChild>
                  <Link href={publicPageHref} target="_blank" rel="noreferrer">
                    {isPublic ? (
                      <ExternalLink className="size-4" />
                    ) : (
                      <EyeOff className="size-4" />
                    )}
                    <span className="hidden sm:inline">View public page</span>
                  </Link>
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {isPublic
                  ? dirty
                    ? "Opens the last saved version — unsaved changes won't show yet."
                    : "Opens the public competition page."
                  : `This competition is ${competition.visibility}, so this link currently 404s for non-admins.`}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          {dirty && !saving && (
            <Button variant="ghost" size="sm" onClick={() => reset()}>
              Discard
            </Button>
          )}

          <Button
            size="sm"
            disabled={saving || !dirty}
            onClick={() => void save()}
          >
            {saving && <Loader2 className="size-4 animate-spin" />}
            {saveLabel}
            {!saving && dirty && (
              <Kbd className="ml-1 hidden sm:inline-flex">Ctrl/⌘+S</Kbd>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
