"use client";

import { useState } from "react";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { Session } from "./active-sessions";

// type Session = {
//   id: string;
//   // add more fields if you want to strongly type this
// };

interface SignOutOtherSessionsDialogProps {
  currentSession?: { data?: { session?: Session } };
  setActiveSessions?: React.Dispatch<
    React.SetStateAction<Session[] | undefined>
  >;
}

/**
 * Dialog for signing out of all other sessions except the current one
 */
export function SignOutOtherSessionsDialog({
  currentSession,
  setActiveSessions,
}: SignOutOtherSessionsDialogProps) {
  const [loading, setLoading] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const handleConfirm = () => {
    setLoading(true);
    authClient.revokeOtherSessions({
      fetchOptions: {
        onRequest() {
          toast.loading("Terminating other sessions...", {
            id: "terminate_sessions",
          });
        },
        onError(context) {
          toast.error(context.error.message, { id: "terminate_sessions" });
          setLoading(false);
        },
        onSuccess() {
          toast.success("Other sessions terminated successfully", {
            id: "terminate_sessions",
          });

          // Update sessions if setter provided
          if (setActiveSessions && currentSession?.data?.session?.id) {
            setActiveSessions(
              (current) =>
                current?.filter(
                  (session) => session.id === currentSession.data?.session?.id
                ) ?? undefined
            );
          }
            setIsDialogOpen(false);
          setLoading(false);
        },
      },
    });
  };

  return (
    <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
      <DialogTrigger asChild>
        <Button variant="destructive" disabled={loading}>
          {loading ? "Processing..." : "Sign out all except current session"}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Terminate other sessions?</DialogTitle>
          <DialogDescription>
            This will sign you out from all devices except your current one. You
            will remain logged in here, but all other active sessions will be
            revoked.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={loading}>
              Cancel
            </Button>
          </DialogClose>
          <Button
            variant="destructive"
            disabled={loading}
            onClick={handleConfirm}
          >
            {loading ? "Processing..." : "Confirm"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Dialog for signing out of ALL sessions, including the current one
 */
export function SignOutAllSessionsDialog() {
  const [loading, setLoading] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const router = useRouter();

  const handleConfirm = () => {
    setLoading(true);
    authClient.revokeSessions({
      fetchOptions: {
        onRequest() {
          toast.loading("Terminating all sessions...", {
            id: "terminate_all_sessions",
          });
        },
        onError(context) {
          toast.error(context.error.message, { id: "terminate_all_sessions" });
          setLoading(false);
        },
        onSuccess() {
          toast.success("All sessions terminated successfully", {
            id: "terminate_all_sessions",
          });
          setLoading(false);
          setIsDialogOpen(false);
          // Redirect to login
          router.push("/sign-in");
        },
      },
    });
  };

  return (
    <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
      <DialogTrigger asChild>
        <Button variant="destructive" disabled={loading}>
          {loading ? "Processing..." : "Sign out all sessions"}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Sign out everywhere?</DialogTitle>
          <DialogDescription>
            This will immediately sign you out from all devices, including this
            one. You will need to sign in again to continue.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={loading}>
              Cancel
            </Button>
          </DialogClose>
          <Button
            variant="destructive"
            disabled={loading}
            onClick={handleConfirm}
          >
            {loading ? "Processing..." : "Confirm"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
