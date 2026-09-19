"use client";

import React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  BellIcon,
  LogIn,
  LogOutIcon,
  MoreVerticalIcon,
  UserCircleIcon,
} from "lucide-react";
import { toast } from "sonner";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { Skeleton } from "../ui/skeleton";

import { authClient } from "@/lib/auth-client";
import AccountSwitcher from "../auth/account-switch";

export function NavUser() {
  const router = useRouter();
  const { isMobile } = useSidebar();

  const currentSessionData = authClient.useSession();
  const currentSession = currentSessionData.data;

  const isSessionLoading =
    currentSessionData.isPending || currentSessionData.isRefetching;

  async function handleSignOut() {
    toast.loading("Signing out...", {
      id: "signout",
      description: null,
    });

    const { error } = await authClient.signOut();

    if (error) {
      toast.error("Sign out failed", {
        id: "signout",
        description: error.message || "Something went wrong",
      });

      return;
    }

    toast.success("Signed out successfully", {
      id: "signout",
      description: "Redirecting...",
    });

    router.push("/");
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        {isSessionLoading ? (
          <SidebarMenuButton size="lg">
            <Skeleton className="h-9 w-full" />
          </SidebarMenuButton>
        ) : !currentSession ? (
          <SidebarMenuButton asChild size="lg">
            <Link href="/sign-in">
              <LogIn />
              <span>Sign in</span>
            </Link>
          </SidebarMenuButton>
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <SidebarMenuButton size="lg">
                <Avatar className="h-8 w-8 rounded-lg">
                  <AvatarImage
                    src={currentSession.user.image ?? undefined}
                    alt={currentSession.user.name}
                  />
                  <AvatarFallback className="rounded-lg">
                    {currentSession.user.name?.charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>

                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">
                    {currentSession.user.name}
                  </span>

                  <span className="truncate text-xs">
                    {currentSession.user.email}
                  </span>
                </div>

                <MoreVerticalIcon className="ml-auto size-4" />
              </SidebarMenuButton>
            </DropdownMenuTrigger>

            <DropdownMenuContent
              className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-lg"
              side={isMobile ? "bottom" : "right"}
              align="end"
              sideOffset={4}
            >
              <DropdownMenuLabel>
                <AccountSwitcher
                  currentSessionData={currentSession}
                  className="w-full"
                />
              </DropdownMenuLabel>

              <DropdownMenuGroup>
                <DropdownMenuItem asChild>
                  <Link href="/user/account">
                    <UserCircleIcon />
                    <span>Account</span>
                  </Link>
                </DropdownMenuItem>

                <DropdownMenuItem asChild>
                  <Link href="/user/notifications">
                    <BellIcon />
                    <span>Notifications</span>
                  </Link>
                </DropdownMenuItem>
              </DropdownMenuGroup>

              <DropdownMenuSeparator />

              <DropdownMenuItem asChild>
                <button className="w-full" onClick={handleSignOut}>
                  <LogOutIcon />
                  <span>Sign out</span>
                </button>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </SidebarMenuItem>
    </SidebarMenu>
  );
}