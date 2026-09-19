"use client";

import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
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

import { useProjectStore } from "../../../store/project.store";

interface ProjectDangerZoneTabProps {
  projectId: string;
}

export function ProjectDangerZoneTab({ projectId }: ProjectDangerZoneTabProps) {
  const router = useRouter();

  const project = useProjectStore((state) => state.project);
  const isDeleting = useProjectStore((state) => state.isDeleting);
  const deleteProject = useProjectStore((state) => state.deleteProject);

  if (!project) {
    return (
      <div className="rounded-lg border p-6">
        <p className="text-sm text-muted-foreground">
          Project data is unavailable.
        </p>
      </div>
    );
  }

  const canDelete = project.permissions.canDelete;

  const handleDelete = async () => {
    const ok = await deleteProject(projectId);

    if (ok) {
      router.push("/projects/my-projects");
    }
  };

  return (
    <div className="max-w-3xl space-y-8">
      <div>
        <h2 className="text-lg font-semibold">Danger Zone</h2>

        <p className="text-sm text-muted-foreground">
          Irreversible actions for this project.
        </p>
      </div>

      {!canDelete && (
        <div className="rounded-md border border-border bg-muted/50 p-3">
          <p className="text-sm text-muted-foreground">
            Only the project owner can delete this project.
          </p>
        </div>
      )}

      {canDelete && (
        <div className="rounded-md border border-destructive/30">
          <div className="p-4">
            <h3 className="text-sm font-semibold text-destructive">
              Delete this project
            </h3>

            <p className="text-sm text-muted-foreground">
              Deleting this project removes it from discovery, My Projects,
              and its public page. This cannot be undone.
            </p>
          </div>

          <div className="flex justify-end border-t p-4">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive">Delete Project</Button>
              </AlertDialogTrigger>

              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete this project?</AlertDialogTitle>

                  <AlertDialogDescription>
                    &quot;{project.title}&quot; will be deleted and will no
                    longer be available. This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>

                <AlertDialogFooter>
                  <AlertDialogCancel disabled={isDeleting}>
                    Cancel
                  </AlertDialogCancel>

                  <AlertDialogAction
                    variant="destructive"
                    disabled={isDeleting}
                    onClick={(event) => {
                      event.preventDefault();

                      void handleDelete();
                    }}
                  >
                    {isDeleting ? "Deleting..." : "Delete Project"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      )}
    </div>
  );
}
