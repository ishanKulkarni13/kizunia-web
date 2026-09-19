"use client";

import { UAParser } from "ua-parser-js";
import { authClient } from "@/lib/auth-client";
import { useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../ui/card";
import { LaptopMinimal, Loader2, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Skeleton } from "../ui/skeleton";
import {
  SignOutAllSessionsDialog,
  SignOutOtherSessionsDialog,
} from "./session-management-buttons";


export type Session = {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  userId: string;
  expiresAt: Date;
  token: string;
  ipAddress?: string | null | undefined | undefined;
  userAgent?: string | null | undefined | undefined;
}; 

export default function ActiveSessions() {
  const [activeSessions, setActiveSessions] = useState<Session[]>();
  const [isTerminating, setIsTerminating] = useState<string>();
  const currentSession = authClient.useSession();
  const router = useRouter();

  const removeActiveSession = (id: string) => {
    if (!activeSessions) return;
    setActiveSessions(() =>
      activeSessions.filter((session) => session.id !== id)
    );
  };

  useEffect(() => {
    async function fetchSessions() {
      const sessions = await authClient.listSessions();
      if (sessions.data) {
        setActiveSessions(sessions.data);
        console.log("sessions", sessions);
      } else {
        console.error("Error fetching sessions:", sessions.error);
      }
    }
    fetchSessions();
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Active Sessions</CardTitle>
        <CardDescription>
          Manage and view your active sessions across different devices.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col md:flex-row gap-2 mb-4">
         
          <SignOutOtherSessionsDialog
            currentSession={currentSession as { data?: { session?: Session } }}
            setActiveSessions={setActiveSessions}
          />
          <SignOutAllSessionsDialog />
        </div>

        {!activeSessions || activeSessions.length === 0 || !currentSession ? (
          [0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-4 w-42 mb-2 last:mb-0" />
          ))
        ) : (
          <>
            {activeSessions
              .filter((session) => session.userAgent)
              .map((session) => {
                return (
                  <div key={session.id} className="mb-2 last:mb-0 ">
                    <div className="flex items-center gap-2 text-sm  text-black font-medium dark:text-white">
                      {new UAParser(session.userAgent || "").getDevice()
                        .type === "mobile" ? (
                        <Smartphone />
                      ) : (
                        <LaptopMinimal />
                      )}
                      {new UAParser(session.userAgent || "").getOS().name ||
                        session.userAgent}
                      ,{" "}
                      {new UAParser(session.userAgent || "").getBrowser().name}
                      <button
                        className="text-red-500 opacity-80  cursor-pointer text-xs border-muted-foreground underline "
                        disabled={!!isTerminating}
                        onClick={async () => {
                          setIsTerminating(session.id);
                          const res = await authClient.revokeSession({
                            token: session.token,
                          });

                          if (res.error) {
                            toast.error(res.error.message);
                          } else {
                            toast.success("Session terminated successfully");
                            removeActiveSession(session.id);
                          }
                          if (session.id === currentSession.data?.session.id)
                            router.push(
                              `/sign-in?email=${currentSession.data?.user.email}`
                            );
                          setIsTerminating(undefined);
                        }}
                      >
                        {isTerminating === session.id ? (
                          <Loader2 size={15} className="animate-spin" />
                        ) : session.id === currentSession.data?.session.id ? (
                          "Sign Out"
                        ) : (
                          "Terminate"
                        )}
                      </button>
                    </div>
                  </div>
                );
              })}
          </>
        )}
      </CardContent>
    </Card>
  );
}
