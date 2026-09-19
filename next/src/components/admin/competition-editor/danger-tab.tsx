"use client";

import { useRouter } from "next/navigation";
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
import { useCompetitionEditorStore } from "@/modules/competitions/store/editor-store";

export function DangerTab() {
  const router = useRouter();

  const competition = useCompetitionEditorStore((state) => state.competition);

  const deleteCompetition = useCompetitionEditorStore(
    (state) => state.deleteCompetition,
  );

  const deleting = useCompetitionEditorStore((state) => state.deleting);

  if (!competition) {
    return null;
  }

  return (
    <div className="space-y-6 pt-6">
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">
          Deleting a competition removes it from every public listing
          immediately. This cannot be undone from the editor.
        </p>

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="destructive" disabled={deleting}>
              {deleting ? "Deleting..." : "Delete Competition"}
            </Button>
          </AlertDialogTrigger>

          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this competition?</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently remove &ldquo;{competition.title}&rdquo;.
                This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>

            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                onClick={async () => {
                  const succeeded = await deleteCompetition();
                  if (succeeded) {
                    router.push("/admin/competitions");
                  }
                }}
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
