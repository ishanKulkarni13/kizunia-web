"use client";

import { Share2Icon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

/**
 * Shares a competition from inside its list row.
 *
 * The row is a stretched link — the title's `::after` covers the whole card —
 * so this button sits above it and must stop the click itself, not merely rely
 * on stacking. Without the `preventDefault`, a share would also navigate.
 *
 * Prefers the native share sheet where one exists, because on a phone that is
 * what "share" means: it can reach WhatsApp and the rest. Everywhere else it
 * falls back to the clipboard, which is what "share" means on a desktop.
 */
export function CompetitionShareButton({
  slug,
  title,
}: {
  slug: string;
  title: string;
}) {
  async function handleShare(event: React.MouseEvent) {
    event.preventDefault();
    event.stopPropagation();

    const url = `${window.location.origin}/competitions/${slug}`;

    if (navigator.share) {
      try {
        await navigator.share({ title, url });
      } catch (error) {
        // Dismissing the share sheet rejects with AbortError. That is the
        // person changing their mind, not a failure to report back to them.
        if ((error as Error)?.name !== "AbortError") {
          toast.error("Could not share this competition.");
        }
      }

      return;
    }

    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copied");
    } catch {
      // The clipboard API is unavailable outside a secure context, so this is
      // reachable on a plain-HTTP deployment rather than being merely defensive.
      toast.error("Could not copy the link.");
    }
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="relative z-10 size-8 text-muted-foreground hover:text-foreground"
      onClick={handleShare}
    >
      <Share2Icon className="size-4" />

      <span className="sr-only">Share {title}</span>
    </Button>
  );
}
