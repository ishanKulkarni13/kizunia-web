"use client";

import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import ReusableImageUploader from "@/components/cloudinary/imageUploader/reusableImageUploader";

import { CompetitionApi } from "@/modules/competitions/api/competition-api";
import { useCompetitionEditorStore } from "@/modules/competitions/store/editor-store";
import { Button } from "@/components/ui/button";

export function AssetsTab() {
  const competition = useCompetitionEditorStore((s) => s.competition);

  const applyPersistedAsset = useCompetitionEditorStore(
    (s) => s.applyPersistedAsset,
  );

  if (!competition) {
    return null;
  }

  return (
    <div className="flex flex-wrap gap-3">
      <Dialog>
        <DialogTrigger asChild>
          <Button variant="secondary">Update Logo</Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Competition Logo</DialogTitle>
          </DialogHeader>
          <ReusableImageUploader
            title="Competition Logo"
            initialImage={competition.logoAsset?.secureUrl ?? ""}
            purpose="COMPETITION_LOGO"
            targetEntityId={competition.id}
            customCropShape="rect"
            accept="image/*"
            onUpload={async (_, asset) => {
              if (!asset) return;

              try {
                const updated = await CompetitionApi.setAsset(
                  competition.id,
                  "logo",
                  { assetId: asset.id },
                );

                applyPersistedAsset("logo", updated);

                toast.success("Logo updated successfully.");
              } catch (error) {
                console.error(error);

                toast.error("Failed to update logo.");
              }
            }}
            onDelete={async () => {
              try {
                const updated = await CompetitionApi.clearAsset(
                  competition.id,
                  "logo",
                );

                applyPersistedAsset("logo", updated);
              } catch (error) {
                console.error(error);

                toast.error("Failed to remove logo.");
              }
            }}
          />
        </DialogContent>
      </Dialog>

      <Dialog>
        <DialogTrigger asChild>
          <Button variant="secondary">Update Banner</Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Competition Banner</DialogTitle>
          </DialogHeader>
          <ReusableImageUploader
            title="Competition Banner"
            initialImage={competition.bannerAsset?.secureUrl ?? ""}
            purpose="COMPETITION_BANNER"
            targetEntityId={competition.id}
            customCropShape="rect"
            aspectRatio={16 / 9}
            accept="image/*"
            onUpload={async (_, asset) => {
              if (!asset) return;

              try {
                const updated = await CompetitionApi.setAsset(
                  competition.id,
                  "banner",
                  { assetId: asset.id },
                );

                applyPersistedAsset("banner", updated);

                toast.success("Banner updated successfully.");
              } catch (error) {
                console.error(error);

                toast.error("Failed to update banner.");
              }
            }}
            onDelete={async () => {
              try {
                const updated = await CompetitionApi.clearAsset(
                  competition.id,
                  "banner",
                );

                applyPersistedAsset("banner", updated);
              } catch (error) {
                console.error(error);

                toast.error("Failed to remove banner.");
              }
            }}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
