"use client";

import { useEffect } from "react";
import Image from "next/image";
import { Save } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { toast } from "sonner";
import { ImageIcon, Pencil } from "lucide-react";

import { ImageUploaderDialog } from "@/components/cloudinary/imageUploader/image-uploader-dialog";
import { ProjectApi } from "../../../api/project-api";
import { useProjectStore } from "../../../store/project.store";
import { useProjectProfileStore } from "../../../store/project-profile.store";

interface ProjectProfileEditorProps {
  projectId: string;
}

export function ProjectProfileEditor({ projectId }: ProjectProfileEditorProps) {
  const project = useProjectStore((state) => state.project);
  const setProject = useProjectStore((state) => state.setProject);

  const form = useProjectProfileStore((state) => state.form);
  const isSaving = useProjectProfileStore((state) => state.isSaving);
  const isDirty = useProjectProfileStore((state) => state.isDirty());
  const error = useProjectProfileStore((state) => state.error);
  const fieldErrors = useProjectProfileStore((state) => state.fieldErrors);

  const initialize = useProjectProfileStore((state) => state.initialize);

  const setField = useProjectProfileStore((state) => state.setField);

  const updateProfile = useProjectProfileStore((state) => state.updateProfile);

  useEffect(() => {
    if (!project) {
      return;
    }

    initialize(project);
  }, [project, initialize]);

  useEffect(() => {
    if (!isDirty) {
      return;
    }

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };

    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [isDirty]);

  if (!project) {
    return (
      <div className="rounded-lg border p-6">
        <p className="text-sm text-muted-foreground">
          Project data is unavailable.
        </p>
      </div>
    );
  }

  const canEdit = project.permissions.canEdit;

  return (
    <div className="max-w-3xl space-y-8">
      <div>
        <h2 className="text-lg font-semibold">Project profile</h2>

        <p className="text-sm text-muted-foreground">
          Manage the basic information and publishing settings for your project.
        </p>
      </div>

      {!canEdit && (
        <div className="rounded-md border border-border bg-muted/50 p-3">
          <p className="text-sm text-muted-foreground">
            You have view-only access to this project. Fields below are
            read-only.
          </p>
        </div>
      )}

      <div className="space-y-6">
        {canEdit && (
          <div className="grid gap-6 sm:grid-cols-2 border-b-2 pb-6">
            <div className="space-y-2 m-auto ">
              <label className="text-sm font-medium">Logo</label>

              <div className="relative size-24">
                {project.logo?.url ? (
                  <Image
                    src={project.logo.url}
                    alt="Project logo"
                    fill
                    sizes="96px"
                    className="rounded-full border object-cover"
                  />
                ) : (
                  <div className="flex size-24 items-center justify-center rounded-full border bg-muted">
                    <ImageIcon className="size-6 text-muted-foreground" />
                  </div>
                )}

                <ImageUploaderDialog
                  dialogTitle="Edit project logo"
                  contentClassName="sm:max-w-lg"
                  title="Project logo"
                  initialImage={project.logo?.url ?? ""}
                  purpose="PROJECT_LOGO"
                  targetEntityId={project.id}
                  customCropShape="round"
                  aspectRatio={1}
                  accept="image/*"
                  onUpload={async (_, asset) => {
                    if (!asset) return;

                    try {
                      const updated = await ProjectApi.setAsset(
                        project.id,
                        "logo",
                        { assetId: asset.id },
                      );

                      setProject(updated);

                      toast.success("Logo updated.");
                    } catch (error) {
                      console.error(error);

                      toast.error("Failed to update logo.");
                    }
                  }}
                  onDelete={async () => {
                    const updated = await ProjectApi.clearAsset(
                      project.id,
                      "logo",
                    );

                    setProject(updated);
                  }}
                >
                  <Button
                    type="button"
                    variant="secondary"
                    size="icon-sm"
                    aria-label="Edit logo"
                    className="absolute -bottom-1 -right-1 rounded-full shadow"
                  >
                    <Pencil className="size-3.5" />
                  </Button>
                </ImageUploaderDialog>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Cover</label>

              <div className="relative aspect-video w-full max-w-3xs">
                {project.cover?.url ? (
                  <Image
                    src={project.cover.url}
                    alt="Project cover"
                    fill
                    sizes="320px"
                    className="rounded-md border object-cover"
                  />
                ) : (
                  <div className="flex size-full items-center justify-center rounded-md border bg-muted">
                    <ImageIcon className="size-6 text-muted-foreground" />
                  </div>
                )}

                <ImageUploaderDialog
                  dialogTitle="Edit project cover"
                  contentClassName="sm:max-w-lg"
                  title="Project cover"
                  initialImage={project.cover?.url ?? ""}
                  purpose="PROJECT_COVER"
                  targetEntityId={project.id}
                  customCropShape="rect"
                  aspectRatio={16 / 9}
                  accept="image/*"
                  onUpload={async (_, asset) => {
                    if (!asset) return;

                    try {
                      const updated = await ProjectApi.setAsset(
                        project.id,
                        "cover",
                        { assetId: asset.id },
                      );

                      setProject(updated);

                      toast.success("Cover updated.");
                    } catch (error) {
                      console.error(error);

                      toast.error("Failed to update cover.");
                    }
                  }}
                  onDelete={async () => {
                    const updated = await ProjectApi.clearAsset(
                      project.id,
                      "cover",
                    );

                    setProject(updated);
                  }}
                >
                  <Button
                    type="button"
                    variant="secondary"
                    size="icon-sm"
                    aria-label="Edit cover"
                    className="absolute -bottom-1 -right-1 rounded-full shadow"
                  >
                    <Pencil className="size-3.5" />
                  </Button>
                </ImageUploaderDialog>
              </div>
            </div>
          </div>
        )}

        <div className="space-y-2">
          <label className="text-sm font-medium">Title</label>

          <Input
            value={form.title}
            disabled={!canEdit}
            onChange={(event) => setField("title", event.target.value)}
            aria-invalid={Boolean(fieldErrors.title)}
          />

          {fieldErrors.title && (
            <p className="text-xs text-destructive">{fieldErrors.title}</p>
          )}
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">Slug</label>

          <Input
            value={form.slug}
            disabled={!canEdit}
            onChange={(event) => setField("slug", event.target.value)}
            aria-invalid={Boolean(fieldErrors.slug)}
          />

          <p className="text-xs text-muted-foreground">
            Used in the public project URL.
          </p>

          {fieldErrors.slug && (
            <p className="text-xs text-destructive">{fieldErrors.slug}</p>
          )}
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">Short description</label>

          <Textarea
            value={form.shortDescription}
            disabled={!canEdit}
            onChange={(event) =>
              setField("shortDescription", event.target.value)
            }
            rows={4}
            aria-invalid={Boolean(fieldErrors.shortDescription)}
          />

          {fieldErrors.shortDescription && (
            <p className="text-xs text-destructive">
              {fieldErrors.shortDescription}
            </p>
          )}
        </div>

        <div className="grid gap-6 sm:grid-cols-2">
          <div className="space-y-2">
            <label className="text-sm font-medium">Status</label>

            <Select
              value={form.status}
              disabled={!canEdit}
              onValueChange={(value) =>
                setField("status", value as typeof form.status)
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>

              <SelectContent>
                <SelectItem value="DRAFT">Draft</SelectItem>

                <SelectItem value="PUBLISHED">Published</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Visibility</label>

            <Select
              value={form.visibility}
              disabled={!canEdit}
              onValueChange={(value) =>
                setField("visibility", value as typeof form.visibility)
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>

              <SelectContent>
                <SelectItem value="PUBLIC">Public</SelectItem>

                <SelectItem value="UNLISTED">Unlisted</SelectItem>

                <SelectItem value="PRIVATE">Private</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
            <p className="text-sm text-destructive">{error}</p>
          </div>
        )}

        {canEdit && (
          <div className="flex justify-end border-t pt-6">
            <Button
              disabled={isSaving || !isDirty}
              onClick={() =>
                void updateProfile({
                  id: projectId,
                })
              }
            >
              <Save />

              {isSaving ? "Saving..." : "Save changes"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
