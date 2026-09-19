"use client";

import { Share2Icon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

/**
 * Shares a project's public view page. Prefers the native share sheet where
 * one exists, falls back to copying the link to the clipboard.
 */
export function ProjectShareButton({
  slug,
  title,
}: {
  slug: string;
  title: string;
}) {
  async function handleShare() {
    const url = `${window.location.origin}/projects/${slug}`;

    if (navigator.share) {
      try {
        await navigator.share({ title, url });
      } catch (error) {
        if ((error as Error)?.name !== "AbortError") {
          toast.error("Could not share this project.");
        }
      }

      return;
    }

    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copied");
    } catch {
      toast.error("Could not copy the link.");
    }
  }

  return (
    <Button type="button" variant="outline" size="sm" onClick={handleShare}>
      <Share2Icon />
      Share
    </Button>
  );
}
