"use client";

import { authClient } from "@/lib/auth-client";
import { toast } from "sonner";
import ReusableImageUploader from "../cloudinary/imageUploader/reusableImageUploader";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
export default function UserProfileEdit() {
  return (
    <>
      <Dialog >
        <DialogTrigger>Open</DialogTrigger>
        <DialogContent>
          <ReusableImageUploader
            title="jhjhjh"
            initialImage={""}
            purpose="USER_AVATAR"
            customCropShape="rect"
            accept="image/*"
            // setOpen={true}
            onUpload={async (url) => {
              toast.success(url);
              try {
                await authClient.updateUser({ image: url });
                toast.success("Profile photo updated");
              } catch (e) {
                console.log(e);
              } finally {
              }
            }}
            onDelete={async () => {
              try {
                await authClient.updateUser({ image: null });
                toast.success("Profile photo removed");
              } catch (e) {
                console.error(e);
              } finally {
              }
            }}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
